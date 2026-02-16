"""
Unified user workflow tasks.

Consolidates user-related maintenance tasks:
- cleanup_unverified_accounts
- process_import_job
- fetch_anime_by_external_id
- cleanup_old_import_jobs
"""

import logging
import asyncio
from datetime import timedelta
from typing import Dict, List, Optional
from celery import shared_task
from django.utils import timezone
from django.contrib.auth import get_user_model

from anime.services.anilist import AniListService
from users.models import UserImportJob
from users.import_services import ImportService

logger = logging.getLogger(__name__)
User = get_user_model()


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

        # Find unverified users older than threshold
        users_to_delete = User.objects.filter(
            userprofile__email_verified=False, date_joined__lt=threshold_date
        )

        count = users_to_delete.count()

        if count > 0:
            # Log usernames before deletion for audit
            usernames = list(users_to_delete.values_list("username", flat=True))
            users_to_delete.delete()

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

        logger.info(f"Import job {job_id} completed successfully")

        return {
            "job_id": job_id,
            "status": "success",
            "result": result,
        }

    except Exception as exc:
        logger.error(f"Import job {job_id} failed: {exc}")

        # Update job status to failed
        job.status = UserImportJob.ImportStatus.failed
        job.errors.append(str(exc))
        job.save(update_fields=["status", "errors"])

        # Retry the task
        raise self.retry(exc=exc, countdown=60)


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
            results = asyncio.run(service.search_anime(query=title, limit=1))
            if results:
                anime_data = results[0]
                anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                logger.info(f"Created/updated anime: {anime.title}")
                return anime.id

        logger.warning(
            f"Could not find anime: MAL={mal_id}, AniList={anilist_id}, Title={title}"
        )
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

    Args:
        cleanup_unverified: Whether to clean unverified accounts
        cleanup_imports: Whether to clean old import jobs
        unverified_days: Days threshold for unverified accounts
        import_days: Days threshold for import jobs

    Returns:
        Dict with workflow results
    """
    results = {}

    if cleanup_unverified:
        results["unverified_cleanup"] = cleanup_unverified_accounts.delay(
            days=unverified_days
        ).get()

    if cleanup_imports:
        results["import_cleanup"] = cleanup_old_import_jobs.delay(
            days=import_days
        ).get()

    logger.info(f"User maintenance workflow complete: {results}")
    return results


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
    from django.db.models import Count, Sum, Avg, F, Q
    from users.models import UserStats, UserAnimeList

    start_time = timezone.now()
    updated_count = 0

    try:
        if user_id:
            # Update single user
            users = User.objects.filter(id=user_id)
        else:
            # Update all active users (logged in within last 30 days)
            thirty_days_ago = timezone.now() - timedelta(days=30)
            users = User.objects.filter(last_login__gte=thirty_days_ago).select_related(
                "userprofile"
            )

        total_users = users.count()
        logger.info(f"Starting stats update for {total_users} users")

        for user in users.iterator(chunk_size=100):
            try:
                # Get or create stats record
                stats, created = UserStats.objects.get_or_create(user=user)

                # Calculate social stats (fast - indexed)
                stats.followers_count = user.followers.count()
                stats.following_count = user.following.count()

                # Calculate anime stats
                anime_stats = UserAnimeList.objects.filter(user=user).aggregate(
                    anime_count=Count("id", distinct=True),
                    episodes_watched=Sum("episodes_watched"),
                    mean_score=Avg("score", filter=Q(score__gt=0)),
                )

                stats.anime_count = anime_stats["anime_count"] or 0
                stats.episodes_watched = anime_stats["episodes_watched"] or 0
                stats.mean_score = anime_stats["mean_score"]

                # Calculate total minutes (expensive - use pre-calculated episodes)
                total_minutes = (
                    UserAnimeList.objects.filter(user=user).aggregate(
                        total=Sum(F("episodes_watched") * F("anime__duration_minutes"))
                    )["total"]
                    or 0
                )

                stats.total_minutes = total_minutes
                stats.days_watched = round(total_minutes / 1440.0, 1)

                # Calculate activity stats
                stats.favorites_count = user.favorites.count()
                stats.reviews_count = user.reviews.count()

                stats.save()
                updated_count += 1

                # Log progress every 100 users
                if updated_count % 100 == 0:
                    logger.info(
                        f"Updated stats for {updated_count}/{total_users} users"
                    )

            except Exception as e:
                logger.error(f"Error updating stats for user {user.id}: {e}")
                continue

        duration = (timezone.now() - start_time).total_seconds()
        logger.info(f"Stats update complete: {updated_count} users in {duration:.2f}s")

        return {
            "updated_count": updated_count,
            "total_users": total_users,
            "duration_seconds": duration,
        }

    except Exception as e:
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
    from api.views.users import get_annotated_user_queryset
    from api.serializers import PublicUserSerializer
    from django.core.cache import cache

    if not usernames:
        # Get users with most activity (most follows + anime watched)
        from django.db.models import Count

        popular_users = User.objects.annotate(
            total_activity=Count("followers")
            + Count("following")
            + Count("anime_lists")
        ).order_by("-total_activity")[:50]

        usernames = list(popular_users.values_list("username", flat=True))

    warmed_count = 0
    for username in usernames:
        try:
            # Get user with annotations
            user = get_annotated_user_queryset().filter(username=username).first()
            if not user:
                continue

            # Serialize and cache
            serializer = PublicUserSerializer(user)
            data = serializer.data

            # Use simple cache key (no viewer_id for public data)
            cache_key = f"public_profile:{username}:v0"
            cache.set(cache_key, data, timeout=1800)  # 30 minutes

            warmed_count += 1

        except Exception as e:
            logger.error(f"Error warming cache for {username}: {e}")
            continue

    logger.info(f"Warmed cache for {warmed_count} profiles")
    return {"warmed_count": warmed_count}
