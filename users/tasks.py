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
