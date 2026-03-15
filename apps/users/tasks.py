from apps.shared.logger import logger

"""
Unified user workflow tasks.

Consolidates user-related maintenance tasks:
- cleanup_unverified_accounts
- process_import_job
- fetch_anime_by_external_id
- cleanup_old_import_jobs
"""

import asyncio
from datetime import timedelta
from typing import Dict, List, Optional

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction
from django.db.utils import InterfaceError, OperationalError
from django.utils import timezone

from apps.animes.services.anilist import AniListService
from apps.users.models import UserImportJob
from apps.users.services.import_service import ImportService

User = get_user_model()
RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
)
def cleanup_unverified_accounts(self, days: int = 7):
    """
    Delete accounts that haven't verified their email within specified days.

    Args:
        days: Number of days before deleting unverified accounts

    Returns:
        Dict with cleanup results
    """
    try:
        threshold_date = timezone.now() - timedelta(days=days)

        users_to_delete = User.objects.filter(
            userprofile__email_verified=False, date_joined__lt=threshold_date
        )

        user_ids = list(users_to_delete.values_list("id", flat=True))
        usernames = list(users_to_delete.values_list("username", flat=True))
        count = len(user_ids)

        if count > 0:
            from apps.animes.models import (
                Review,
                ReviewComment,
                ReviewVote,
                UserFavorite,
                UserHistory,
                UserRecommendation,
            )
            from apps.core.models import Notification, PushSubscription
            from apps.forums.models import Post, PostLike, Thread, ThreadLike
            from apps.users.models import (
                SocialLinkChangeLog,
                UserActivity,
                UserAnimeList,
                UserBadge,
                UserFollow,
                UserStats,
            )

            db = User.objects.db

            with transaction.atomic():
                # Mirror manual account deletion cleanup to avoid signal side effects
                # (e.g. on_commit activity creation for users being deleted).
                PostLike.objects.filter(post__author_id__in=user_ids)._raw_delete(db)
                PostLike.objects.filter(user_id__in=user_ids)._raw_delete(db)
                ThreadLike.objects.filter(thread__author_id__in=user_ids)._raw_delete(db)
                ThreadLike.objects.filter(user_id__in=user_ids)._raw_delete(db)
                Post.objects.filter(thread__author_id__in=user_ids)._raw_delete(db)
                Post.objects.filter(author_id__in=user_ids)._raw_delete(db)
                Thread.objects.filter(author_id__in=user_ids)._raw_delete(db)

                ReviewComment.objects.filter(review__user_id__in=user_ids)._raw_delete(db)
                ReviewComment.objects.filter(user_id__in=user_ids)._raw_delete(db)
                ReviewVote.objects.filter(review__user_id__in=user_ids)._raw_delete(db)
                ReviewVote.objects.filter(user_id__in=user_ids)._raw_delete(db)
                Review.objects.filter(user_id__in=user_ids)._raw_delete(db)

                UserActivity.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserAnimeList.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserFavorite.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserHistory.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserRecommendation.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserStats.objects.filter(user_id__in=user_ids)._raw_delete(db)
                UserFollow.objects.filter(follower_id__in=user_ids)._raw_delete(db)
                UserFollow.objects.filter(following_id__in=user_ids)._raw_delete(db)
                UserBadge.objects.filter(user_id__in=user_ids)._raw_delete(db)
                SocialLinkChangeLog.objects.filter(user_id__in=user_ids)._raw_delete(db)
                Notification.objects.filter(user_id__in=user_ids)._raw_delete(db)
                PushSubscription.objects.filter(user_id__in=user_ids)._raw_delete(db)

                User.objects.filter(id__in=user_ids).delete()

            logger.info(f"Deleted {count} unverified accounts: {usernames}")
        else:
            logger.info("No unverified accounts to clean up")

        return {
            "deleted_count": count,
            "threshold_days": days,
            "threshold_date": threshold_date.isoformat(),
        }

    except Exception as e:
        logger.error(f"Error cleaning up unverified accounts: {e}")
        raise self.retry(exc=e)

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def process_import_job(self, job_id: int, **kwargs):
    """
    Process an import job asynchronously.

    Args:
        job_id: The ID of the UserImportJob to process
        **kwargs: Additional arguments passed to the importer

    Returns:
        Dict with processing results
    """
    try:
        job = UserImportJob.objects.get(id=job_id)
    except UserImportJob.DoesNotExist:
        logger.error(f"Import job {job_id} not found")
        return {
            "job_id": job_id,
            "status": "error",
            "reason": "job_not_found",
        }

    # Check if job was cancelled before starting
    if job.status == UserImportJob.ImportStatus.failed:
        logger.info(f"Import job {job_id} was cancelled, skipping")
        return {
            "job_id": job_id,
            "status": "skipped",
            "reason": "job_cancelled",
        }

    try:
        # Create appropriate importer and run it
        importer = ImportService.create_importer(job, **kwargs)
        result = importer.run()

        # Record Prometheus metric
        try:
            from apps.animes.services.metrics import USER_IMPORTS_PROCESSED

            USER_IMPORTS_PROCESSED.labels(
                source=getattr(job, "source", "unknown"), status="success"
            ).inc()
        except Exception:
            pass

        logger.info(f"Import job {job_id} completed successfully")

        return {
            "job_id": job_id,
            "status": "success",
            "result": result,
        }

    except Exception as exc:
        logger.error(f"Import job {job_id} failed: {exc}")

        # Update job status to failed
        error_message = str(exc)
        job.status = UserImportJob.ImportStatus.failed
        if not job.errors or job.errors[-1] != error_message:
            job.errors.append(error_message)
        job.save(update_fields=["status", "errors"])

        # Record Prometheus metric
        try:
            from apps.animes.services.metrics import USER_IMPORTS_PROCESSED

            USER_IMPORTS_PROCESSED.labels(
                source=getattr(job, "source", "unknown"), status="failure"
            ).inc()
        except Exception:
            pass

        # Retry only for transient DB connectivity errors. Importer-level API retries
        # already handle external rate limits and network issues.
        if isinstance(exc, RETRYABLE_DB_ERRORS):
            raise self.retry(exc=exc, countdown=60)

        return {
            "job_id": job_id,
            "status": "failed",
            "reason": "import_failed",
        }

@shared_task(
    max_retries=3,
    default_retry_delay=60,
)
def fetch_anime_by_external_id(
    mal_id: int = None,
    anilist_id: int = None,
    title: str = None,
):
    """
    Fetch anime from AniList API by external ID and create it in the database.

    This is called when an import finds anime that doesn't exist in our DB.

    Args:
        mal_id: MyAnimeList ID
        anilist_id: AniList ID
        title: Anime title (fallback)

    Returns:
        Anime ID if found/created, None otherwise
    """
    service = AniListService()

    try:
        # Try to fetch by AniList ID first (most reliable)
        if anilist_id:
            logger.info(f"Fetching anime by AniList ID: {anilist_id}")
            anime_data = asyncio.run(service.get_anime_by_id(anilist_id))
            if anime_data:
                anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                logger.info(f"Created/updated anime: {anime.title}")
                return anime.id

        # Try to fetch by MAL ID
        if mal_id:
            logger.info(f"Fetching anime by MAL ID: {mal_id}")
            anime_data = asyncio.run(service.search_by_mal_id(mal_id))
            if anime_data:
                anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                logger.info(f"Created/updated anime: {anime.title}")
                return anime.id

        # Try to search by title as last resort
        if title:
            logger.info(f"Searching anime by title: {title}")
            results = asyncio.run(service.search_anime(title))
            if results:
                anime_data = results[0]
                anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                logger.info(f"Created/updated anime: {anime.title}")
                return anime.id

        logger.warning(f"Could not find anime: MAL={mal_id}, AniList={anilist_id}, Title={title}")
        return None

    except Exception as e:
        logger.error(f"Error fetching anime: {e}")
        return None
    finally:
        asyncio.run(service.close())

@shared_task
def cleanup_old_import_jobs(days: int = 30):
    """
    Clean up old import jobs to prevent database bloat.

    Args:
        days: Delete jobs older than this many days

    Returns:
        Number of jobs deleted
    """
    try:
        cutoff_date = timezone.now() - timedelta(days=days)

        old_jobs = UserImportJob.objects.filter(
            created_at__lt=cutoff_date,
            status__in=[
                UserImportJob.ImportStatus.completed,
                UserImportJob.ImportStatus.failed,
            ],
        )

        count = old_jobs.count()
        old_jobs.delete()

        logger.info(f"Cleaned up {count} old import jobs (older than {days} days)")
        return count

    except Exception as e:
        logger.error(f"Error cleaning up import jobs: {e}")
        return 0

@shared_task
def run_user_maintenance_workflow(
    cleanup_unverified: bool = True,
    cleanup_imports: bool = True,
    unverified_days: int = 7,
    import_days: int = 30,
):
    """
    Run comprehensive user maintenance workflow.

    This task orchestrates multiple maintenance tasks. Note: Tasks are triggered
    asynchronously and their results are not waited for (non-blocking).

    Args:
        cleanup_unverified: Whether to clean unverified accounts
        cleanup_imports: Whether to clean old import jobs
        unverified_days: Days threshold for unverified accounts
        import_days: Days threshold for import jobs

    Returns:
        Dict with task IDs for tracking
    """
    from celery import chain

    task_ids = {}

    if cleanup_unverified:
        task = cleanup_unverified_accounts.delay(days=unverified_days)
        task_ids["unverified_cleanup"] = task.id

    if cleanup_imports:
        task = cleanup_old_import_jobs.delay(days=import_days)
        task_ids["import_cleanup"] = task.id

    logger.info(f"User maintenance workflow triggered: {task_ids}")
    return {
        "status": "triggered",
        "task_ids": task_ids,
        "cleanup_unverified": cleanup_unverified,
        "cleanup_imports": cleanup_imports,
    }

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    time_limit=300,  # 5 minutes max
)
def update_user_stats(self, user_id: int = None):
    """
    Update user statistics in the materialized view.

    This task pre-calculates expensive statistics to avoid slow queries
    on the profile page. Run every 5 minutes via Celery beat.

    Args:
        user_id: Specific user to update, or None to update all active users

    Returns:
        Dict with update results
    """
    from django.db.models import Avg, Count, ExpressionWrapper, F, IntegerField, Q, Sum, Value
    from django.db.models.functions import Coalesce

    from apps.animes.models import Review, UserFavorite
    from apps.users.models import UserAnimeList, UserFollow, UserStats

    start_time = timezone.now()
    updated_count = 0

    try:
        if user_id:
            user_ids = list(User.objects.filter(id=user_id).values_list("id", flat=True))
        else:
            thirty_days_ago = timezone.now() - timedelta(days=30)
            user_ids = list(
                User.objects.filter(last_login__gte=thirty_days_ago).values_list("id", flat=True)
            )

        total_users = len(user_ids)
        logger.info(f"Starting stats update for {total_users} users")

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

        existing_stats_map = {
            stats.user_id: stats for stats in UserStats.objects.filter(user_id__in=user_ids)
        }
        now = timezone.now()
        to_create = []
        to_update = []

        for idx, uid in enumerate(user_ids, start=1):
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
                "last_updated": now,
            }

            stats = existing_stats_map.get(uid)
            if stats is None:
                to_create.append(UserStats(user_id=uid, is_active=True, **data))
            else:
                for field, value in data.items():
                    setattr(stats, field, value)
                to_update.append(stats)

            if idx % 100 == 0:
                logger.info(f"Prepared stats for {idx}/{total_users} users")

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
                    "last_updated",
                ],
                batch_size=500,
            )

        updated_count = len(user_ids)

        duration = (timezone.now() - start_time).total_seconds()
        logger.info(f"Stats update complete: {updated_count} users in {duration:.2f}s")

        return {
            "updated_count": updated_count,
            "total_users": total_users,
            "duration_seconds": duration,
        }

    except Exception as e:
        if isinstance(e, RETRYABLE_DB_ERRORS):
            # Transient network/DNS/connection issues happen during deploys
            # and container restarts. Reset stale connections and retry.
            close_old_connections()
            logger.warning(f"Transient DB error in update_user_stats; retrying: {e}")
        else:
            logger.error(f"Error in update_user_stats task: {e}")
        raise self.retry(exc=e)

@shared_task
def update_all_user_stats():
    """
    Update stats for all users - scheduled task run every 5 minutes.
    """
    return update_user_stats.delay()

@shared_task
def warm_profile_cache(usernames: list = None):
    """
    Pre-warm Redis cache for popular user profiles.

    Args:
        usernames: List of usernames to warm, or None for popular users
    """
    from django.core.cache import cache

    from apps.users.serializers.users import PublicUserSerializer
    from apps.users.services.cache import get_public_profile_cache_key
    from apps.users.views.users import get_annotated_user_queryset

    if not usernames:
        from django.db.models import Count

        popular_users = User.objects.annotate(
            total_activity=Count("followers") + Count("following") + Count("anime_lists")
        ).order_by("-total_activity")[:50]

        usernames = list(popular_users.values_list("username", flat=True))

    requested_usernames = [username for username in usernames if username]
    if not requested_usernames:
        return {"warmed_count": 0}

    try:
        # Fetch all requested users in one annotated query (+ one prefetch query for badges)
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
        for user, data in zip(ordered_users, serialized_users):
            # Cache key format used by PublicUserProfileViewSet.retrieve
            cache_key = get_public_profile_cache_key(user.username, viewer_id="anonymous")
            cache.set(cache_key, data, timeout=1800)  # 30 minutes
            warmed_count += 1

    except Exception as e:
        logger.error(f"Error warming profile cache batch: {e}")
        return {"warmed_count": 0}

    logger.info(f"Warmed cache for {warmed_count} profiles")
    return {"warmed_count": warmed_count}
