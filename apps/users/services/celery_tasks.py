"""Service-layer implementations for user Celery tasks."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ...animes.services.anilist import AniListService
from ...shared.logger import logger
from ..models import UserImportJob
from .import_service import ImportService
from .user_queryset import get_annotated_user_queryset

User = get_user_model()


class UserTaskService:
    """Service methods used by Celery task wrappers in ``apps.users.tasks``."""

    MIN_UNVERIFIED_CLEANUP_DAYS = 7

    @staticmethod
    def cleanup_unverified_accounts(days: int = 7) -> dict:
        days = int(days)
        if days < UserTaskService.MIN_UNVERIFIED_CLEANUP_DAYS:
            raise ValueError(f"days must be at least {UserTaskService.MIN_UNVERIFIED_CLEANUP_DAYS}")
        threshold_date = timezone.now() - timedelta(days=days)
        stale_users = list(
            User.objects.filter(
                userprofile__email_verified=False,
                date_joined__lt=threshold_date,
            ).values_list("id", "username")
        )
        user_ids = [user_id for user_id, _ in stale_users]
        usernames = [username for _, username in stale_users]
        count = len(user_ids)

        if count == 0:
            logger.info(
                "Unverified account cleanup found nothing to delete",
                extra={"days": days, "threshold_date": threshold_date.isoformat()},
            )
            return {
                "deleted_count": 0,
                "threshold_days": days,
                "threshold_date": threshold_date.isoformat(),
            }

        with transaction.atomic():
            User.objects.filter(id__in=user_ids).delete()

        logger.info(
            "Deleted unverified accounts",
            extra={
                "deleted_count": count,
                "usernames": usernames,
                "threshold_days": days,
            },
        )
        return {
            "deleted_count": count,
            "threshold_days": days,
            "threshold_date": threshold_date.isoformat(),
        }

    @staticmethod
    def process_import_job(job_id: int, **kwargs) -> dict:
        allow_processing_resume = kwargs.pop("allow_processing_resume", False)

        try:
            with transaction.atomic():
                job = UserImportJob.objects.select_for_update().get(id=job_id)

                if job.status == UserImportJob.ImportStatus.completed:
                    logger.info(
                        "Import job skipped because it already completed", extra={"job_id": job_id}
                    )
                    return {"job_id": job_id, "status": "skipped", "reason": "job_completed"}

                if job.status == UserImportJob.ImportStatus.failed:
                    logger.info(
                        "Import job skipped because it is already failed", extra={"job_id": job_id}
                    )
                    return {"job_id": job_id, "status": "skipped", "reason": "job_cancelled"}

                if (
                    job.status == UserImportJob.ImportStatus.processing
                    and not allow_processing_resume
                ):
                    logger.warning(
                        "Import job skipped because another worker is already processing it",
                        extra={"job_id": job_id},
                    )
                    return {"job_id": job_id, "status": "skipped", "reason": "already_processing"}

                if job.status != UserImportJob.ImportStatus.processing:
                    job.status = UserImportJob.ImportStatus.processing
                    job.started_at = timezone.now()
                    job.save(update_fields=["status", "started_at"])
        except UserImportJob.DoesNotExist:
            logger.error("Import job not found", extra={"job_id": job_id})
            return {"job_id": job_id, "status": "error", "reason": "job_not_found"}

        importer = ImportService.create_importer(job, **kwargs)
        result = importer.run()

        # Metric objects swallow their own failures.
        from ...animes.services.metrics import USER_IMPORTS_PROCESSED

        USER_IMPORTS_PROCESSED.labels(
            source=getattr(job, "source", "unknown"),
            status="success",
        ).inc()

        logger.info("Import job completed", extra={"job_id": job_id})
        return {"job_id": job_id, "status": "success", "result": result}

    @staticmethod
    def mark_import_job_failed(job_id: int, error_message: str) -> None:
        try:
            with transaction.atomic():
                job = UserImportJob.objects.select_for_update().get(id=job_id)
                job.status = UserImportJob.ImportStatus.failed
                errors = list(job.errors or [])
                if not errors or errors[-1] != error_message:
                    errors.append(error_message)
                job.errors = errors
                job.save(update_fields=["status", "errors"])
        except UserImportJob.DoesNotExist:
            logger.warning(
                "Import job disappeared before failure status could be stored",
                extra={"job_id": job_id},
            )
            return

        # Metric objects swallow their own failures.
        from ...animes.services.metrics import USER_IMPORTS_PROCESSED

        USER_IMPORTS_PROCESSED.labels(
            source=getattr(job, "source", "unknown"),
            status="failure",
        ).inc()

    @staticmethod
    def fetch_anime_by_external_id(
        mal_id: int | None = None,
        anilist_id: int | None = None,
        title: str | None = None,
    ) -> int | None:
        service = AniListService(enable_caching=True, enable_rate_limiting=True)

        try:
            if anilist_id:
                logger.info("Fetching anime by AniList ID", extra={"anilist_id": anilist_id})
                anime_data = service.get_anime_by_id(anilist_id)
                if anime_data:
                    anime = service.save_anime_to_db(anime_data)
                    return anime.id

            if mal_id:
                logger.info("Fetching anime by MAL ID", extra={"mal_id": mal_id})
                anime_data = service.search_by_mal_id(mal_id)
                if anime_data:
                    anime = service.save_anime_to_db(anime_data)
                    return anime.id

            if title:
                logger.info("Searching anime by title", extra={"title": title})
                results = service.search_anime(title)
                if results:
                    anime = service.save_anime_to_db(results[0])
                    return anime.id

            logger.warning(
                "Anime lookup by external identifiers returned no result",
                extra={"mal_id": mal_id, "anilist_id": anilist_id, "title": title},
            )
            return None
        finally:
            service.close()

    @staticmethod
    def cleanup_old_import_jobs(days: int = 30) -> int:
        cutoff_date = timezone.now() - timedelta(days=days)
        queryset = UserImportJob.objects.filter(
            created_at__lt=cutoff_date,
            status__in=[
                UserImportJob.ImportStatus.completed,
                UserImportJob.ImportStatus.failed,
            ],
        )
        deleted_count = queryset.count()
        queryset.delete()
        logger.info(
            "Cleaned up old import jobs",
            extra={"deleted_count": deleted_count, "days": days},
        )
        return deleted_count

    @staticmethod
    def run_user_maintenance_workflow(
        cleanup_unverified: bool = True,
        cleanup_imports: bool = True,
        unverified_days: int = 7,
        import_days: int = 30,
    ) -> dict:
        from ..tasks import cleanup_old_import_jobs, cleanup_unverified_accounts

        if int(unverified_days) < UserTaskService.MIN_UNVERIFIED_CLEANUP_DAYS:
            raise ValueError(
                f"unverified_days must be at least {UserTaskService.MIN_UNVERIFIED_CLEANUP_DAYS}"
            )

        task_ids: dict[str, str] = {}

        if cleanup_unverified:
            task_ids["unverified_cleanup"] = cleanup_unverified_accounts.delay(
                days=unverified_days
            ).id
        if cleanup_imports:
            task_ids["import_cleanup"] = cleanup_old_import_jobs.delay(days=import_days).id

        logger.info(
            "Queued user maintenance workflow",
            extra={
                "task_ids": task_ids,
                "cleanup_unverified": cleanup_unverified,
                "cleanup_imports": cleanup_imports,
            },
        )
        return {
            "status": "triggered",
            "task_ids": task_ids,
            "cleanup_unverified": cleanup_unverified,
            "cleanup_imports": cleanup_imports,
        }

    @staticmethod
    def update_user_stats(user_id: int | None = None) -> dict:
        """Refresh ``UserStats`` for one user, or for everyone seen in the last 30 days."""
        from .stats_service import save_user_stats

        start_time = timezone.now()
        if user_id:
            user_ids = list(User.objects.filter(id=user_id).values_list("id", flat=True))
        else:
            thirty_days_ago = timezone.now() - timedelta(days=30)
            user_ids = list(
                User.objects.filter(last_login__gte=thirty_days_ago).values_list("id", flat=True)
            )
        logger.info(
            "Preparing user stats update", extra={"user_count": len(user_ids), "user_id": user_id}
        )
        updated = save_user_stats(user_ids)
        duration = (timezone.now() - start_time).total_seconds()
        logger.info(
            "Updated user stats", extra={"updated_count": updated, "duration_seconds": duration}
        )
        return {
            "updated_count": updated,
            "total_users": len(user_ids),
            "duration_seconds": duration,
        }

    @staticmethod
    def queue_stale_user_stats_refreshes(
        *,
        stale_after_minutes: int,
        batch_size: int,
    ) -> dict:
        from ..models import UserStats
        from ..tasks import schedule_user_stats_refresh

        now = timezone.now()
        active_cutoff = now - timedelta(days=30)
        refresh_cutoff = now - timedelta(minutes=max(int(stale_after_minutes), 1))
        active_user_ids = list(
            User.objects.filter(last_login__gte=active_cutoff).values_list("id", flat=True)
        )
        if not active_user_ids:
            return {"status": "noop", "queued": 0, "candidates": 0, "task_ids": []}

        fresh_user_ids = set(
            UserStats.objects.filter(
                user_id__in=active_user_ids,
                last_updated__gte=refresh_cutoff,
            ).values_list("user_id", flat=True)
        )
        stale_user_ids = [user_id for user_id in active_user_ids if user_id not in fresh_user_ids][
            : max(int(batch_size), 1)
        ]

        task_ids: list[str] = []
        for user_id in stale_user_ids:
            task_result = schedule_user_stats_refresh(
                user_id=user_id,
                dedupe_ttl_seconds=max(int(stale_after_minutes) * 60, 60),
            )
            if task_result is not None:
                task_ids.append(task_result.id)

        return {
            "status": "queued" if task_ids else "noop",
            "queued": len(task_ids),
            "candidates": len(stale_user_ids),
            "task_ids": task_ids,
            "stale_after_minutes": stale_after_minutes,
            "batch_size": batch_size,
        }

    @staticmethod
    def warm_profile_cache(usernames: list[str] | None = None) -> dict:
        from django.core.cache import cache
        from django.db.models import Count

        from ..serializers.accounts import PublicUserSerializer
        from .cache import get_public_profile_cache_key

        selected_usernames = usernames
        if not selected_usernames:
            popular_users = (
                User.objects.annotate(
                    total_activity=Count("followers", distinct=True)
                    + Count("following", distinct=True)
                    + Count("anime_lists", distinct=True)
                )
                .order_by("-total_activity")
                .values_list("username", flat=True)[:50]
            )
            selected_usernames = list(popular_users)

        requested_usernames = [username for username in selected_usernames or [] if username]
        if not requested_usernames:
            return {"warmed_count": 0}

        users = get_annotated_user_queryset(lightweight=False).filter(
            username__in=requested_usernames
        )
        users_by_username = {user.username: user for user in users}
        ordered_users = [
            users_by_username[username]
            for username in requested_usernames
            if username in users_by_username
        ]
        serialized_users = PublicUserSerializer(ordered_users, many=True).data

        warmed_count = 0
        for user, data in zip(ordered_users, serialized_users, strict=False):
            cache_key = get_public_profile_cache_key(user.username, viewer_id="anonymous")
            cache.set(cache_key, data, timeout=1800)
            warmed_count += 1

        logger.info("Warmed public profile cache", extra={"warmed_count": warmed_count})
        return {"warmed_count": warmed_count}
