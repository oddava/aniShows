"""Service-layer implementations for user Celery tasks."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.animes.services.jikan import JikanService
from apps.users.models import UserImportJob
from apps.users.services.import_service import ImportService
from apps.users.services.user_queryset import get_annotated_user_queryset

logger = logging.getLogger(__name__)

User = get_user_model()


class UserTaskService:
    """Service methods used by Celery task wrappers in ``apps.users.tasks``."""

    @staticmethod
    def cleanup_unverified_accounts(days: int = 7) -> dict:
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
                    logger.info("Import job skipped because it already completed", extra={"job_id": job_id})
                    return {"job_id": job_id, "status": "skipped", "reason": "job_completed"}

                if job.status == UserImportJob.ImportStatus.failed:
                    logger.info("Import job skipped because it is already failed", extra={"job_id": job_id})
                    return {"job_id": job_id, "status": "skipped", "reason": "job_cancelled"}

                if job.status == UserImportJob.ImportStatus.processing and not allow_processing_resume:
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

        try:
            from apps.animes.services.metrics import USER_IMPORTS_PROCESSED

            USER_IMPORTS_PROCESSED.labels(
                source=getattr(job, "source", "unknown"),
                status="success",
            ).inc()
        except Exception:
            logger.debug("Unable to record import success metric", exc_info=True)

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

        try:
            from apps.animes.services.metrics import USER_IMPORTS_PROCESSED

            USER_IMPORTS_PROCESSED.labels(
                source=getattr(job, "source", "unknown"),
                status="failure",
            ).inc()
        except Exception:
            logger.debug("Unable to record import failure metric", exc_info=True)

    @staticmethod
    def fetch_anime_by_external_id(
        mal_id: int | None = None,
        anilist_id: int | None = None,
        title: str | None = None,
    ) -> int | None:
        service = JikanService(enable_caching=True, enable_rate_limiting=True)

        try:
            if anilist_id:
                logger.info("Fetching anime by sync ID", extra={"anilist_id": anilist_id})
                anime_data = asyncio.run(service.get_anime_by_id(anilist_id))
                if anime_data:
                    anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                    return anime.id

            if mal_id:
                logger.info("Fetching anime by MAL ID", extra={"mal_id": mal_id})
                anime_data = asyncio.run(service.search_by_mal_id(mal_id))
                if anime_data:
                    anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                    return anime.id

            if title:
                logger.info("Searching anime by title", extra={"title": title})
                results = asyncio.run(service.search_anime(title))
                if results:
                    anime = asyncio.run(service._save_anime_to_db_async(results[0]))
                    return anime.id

            logger.warning(
                "Anime lookup by external identifiers returned no result",
                extra={"mal_id": mal_id, "anilist_id": anilist_id, "title": title},
            )
            return None
        finally:
            asyncio.run(service.close())

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
        from apps.users.tasks import cleanup_old_import_jobs, cleanup_unverified_accounts

        task_ids: dict[str, str] = {}

        if cleanup_unverified:
            task_ids["unverified_cleanup"] = cleanup_unverified_accounts.delay(days=unverified_days).id
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
        from django.db.models import Avg, Count, ExpressionWrapper, F, IntegerField, Q, Sum, Value
        from django.db.models.functions import Coalesce

        from apps.animes.models import Review, ReviewVote, UserFavorite
        from apps.users.models import UserAnimeList, UserFollow, UserStats

        start_time = timezone.now()

        if user_id:
            user_ids = list(User.objects.filter(id=user_id).values_list("id", flat=True))
        else:
            thirty_days_ago = timezone.now() - timedelta(days=30)
            user_ids = list(
                User.objects.filter(last_login__gte=thirty_days_ago).values_list("id", flat=True)
            )

        total_users = len(user_ids)
        logger.info("Preparing user stats update", extra={"user_count": total_users, "user_id": user_id})

        if total_users == 0:
            return {
                "updated_count": 0,
                "total_users": 0,
                "duration_seconds": (timezone.now() - start_time).total_seconds(),
            }

        followers_counts = {
            row["following_id"]: row["total"]
            for row in UserFollow.objects.filter(following_id__in=user_ids)
            .values("following_id")
            .annotate(total=Count("id"))
        }
        following_counts = {
            row["follower_id"]: row["total"]
            for row in UserFollow.objects.filter(follower_id__in=user_ids)
            .values("follower_id")
            .annotate(total=Count("id"))
        }
        minutes_expr = ExpressionWrapper(
            F("episodes_watched") * Coalesce(F("anime__duration_minutes"), Value(0)),
            output_field=IntegerField(),
        )
        anime_stats_map = {
            row["user_id"]: row
            for row in UserAnimeList.objects.filter(user_id__in=user_ids)
            .values("user_id")
            .annotate(
                anime_count=Count("id", distinct=True),
                episodes_watched_total=Coalesce(Sum("episodes_watched"), 0),
                mean_score=Avg("score", filter=Q(score__gt=0)),
                total_minutes=Coalesce(Sum(minutes_expr), 0),
            )
        }
        favorites_counts = {
            row["user_id"]: row["total"]
            for row in UserFavorite.objects.filter(user_id__in=user_ids)
            .values("user_id")
            .annotate(total=Count("id"))
        }
        reviews_counts = {
            row["user_id"]: row["total"]
            for row in Review.objects.filter(user_id__in=user_ids)
            .values("user_id")
            .annotate(total=Count("id"))
        }
        resonance_counts = {
            row["review__user_id"]: row["total"]
            for row in ReviewVote.objects.filter(
                review__user_id__in=user_ids,
                vote_type=ReviewVote.VoteType.HELPFUL,
            )
            .values("review__user_id")
            .annotate(total=Count("id"))
        }

        existing_stats_map = {
            stats.user_id: stats for stats in UserStats.objects.filter(user_id__in=user_ids)
        }
        now = timezone.now()
        to_create = []
        to_update = []

        for uid in user_ids:
            anime_data = anime_stats_map.get(uid, {})
            total_minutes = int(anime_data.get("total_minutes") or 0)
            data = {
                "followers_count": int(followers_counts.get(uid, 0)),
                "following_count": int(following_counts.get(uid, 0)),
                "anime_count": int(anime_data.get("anime_count") or 0),
                "episodes_watched": int(anime_data.get("episodes_watched_total") or 0),
                "total_minutes": total_minutes,
                "days_watched": round(total_minutes / 1440.0, 1),
                "mean_score": anime_data.get("mean_score"),
                "favorites_count": int(favorites_counts.get(uid, 0)),
                "reviews_count": int(reviews_counts.get(uid, 0)),
                "resonance_count": int(resonance_counts.get(uid, 0)),
                "last_updated": now,
            }

            stats = existing_stats_map.get(uid)
            if stats is None:
                to_create.append(UserStats(user_id=uid, is_active=True, **data))
            else:
                for field, value in data.items():
                    setattr(stats, field, value)
                to_update.append(stats)

        if to_create:
            UserStats.objects.bulk_create(to_create, batch_size=500)
        if to_update:
            UserStats.objects.bulk_update(
                to_update,
                [
                    "followers_count",
                    "following_count",
                    "anime_count",
                    "episodes_watched",
                    "total_minutes",
                    "days_watched",
                    "mean_score",
                    "favorites_count",
                    "reviews_count",
                    "resonance_count",
                    "last_updated",
                ],
                batch_size=500,
            )

        duration = (timezone.now() - start_time).total_seconds()
        logger.info(
            "Updated user stats",
            extra={"updated_count": len(user_ids), "duration_seconds": duration},
        )
        return {
            "updated_count": len(user_ids),
            "total_users": total_users,
            "duration_seconds": duration,
        }

    @staticmethod
    def warm_profile_cache(usernames: list[str] | None = None) -> dict:
        from django.core.cache import cache
        from django.db.models import Count

        from apps.users.serializers.users import PublicUserSerializer
        from apps.users.services.cache import get_public_profile_cache_key

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
