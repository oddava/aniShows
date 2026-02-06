from celery import shared_task
from django.utils import timezone
from django.contrib.auth import get_user_model
from datetime import timedelta
import logging
import asyncio

logger = logging.getLogger(__name__)
User = get_user_model()


@shared_task
def cleanup_unverified_accounts():
    """
    Delete accounts that have not verified their email within 7 days.
    """
    logger.info("Starting unverified accounts cleanup")

    threshold_date = timezone.now() - timedelta(days=7)

    # Find users who are not verified and joined before threshold
    # Note: We're using the email_verified field on UserProfile

    # We can filter users whose profile has email_verified=False
    # AND date_joined < threshold_date

    users_to_delete = User.objects.filter(
        userprofile__email_verified=False, date_joined__lt=threshold_date
    )

    count = users_to_delete.count()

    if count > 0:
        # bulk delete doesn't call delete() method on instances, so signals might not fire
        # but standard User delete is usually safe with cascades.
        # However, for safety and logging, we might want to iterate if count is small
        # or just delete.

        users_to_delete.delete()
        logger.info(
            f"Deleted {count} unverified accounts created before {threshold_date}"
        )
    else:
        logger.info("No unverified accounts to clean up")

    return f"Deleted {count} accounts"


@shared_task(bind=True, max_retries=3)
def process_import_job(self, job_id: int, **kwargs):
    """
    Process an import job asynchronously

    Args:
        job_id: The ID of the UserImportJob to process
        **kwargs: Additional arguments passed to the importer (username, xml_content, etc.)
    """
    from users.models import UserImportJob
    from users.import_services import ImportService

    try:
        job = UserImportJob.objects.get(id=job_id)
    except UserImportJob.DoesNotExist:
        logger.error(f"Import job {job_id} not found")
        return

    # Check if job was cancelled before starting
    if job.status == UserImportJob.ImportStatus.failed:
        logger.info(f"Import job {job_id} was cancelled, skipping")
        return

    try:
        # Create appropriate importer and run it
        importer = ImportService.create_importer(job, **kwargs)
        importer.run()

        logger.info(f"Import job {job_id} completed successfully")

    except Exception as exc:
        logger.error(f"Import job {job_id} failed: {exc}")

        # Update job status to failed
        job.status = UserImportJob.ImportStatus.failed
        job.errors.append(str(exc))
        job.save(update_fields=["status", "errors"])

        # Retry the task
        raise self.retry(exc=exc, countdown=60)


@shared_task
def fetch_anime_by_external_id(
    mal_id: int = None, anilist_id: int = None, title: str = None
):
    """
    Fetch anime from AniList API by external ID and create it in the database.
    This is called when an import finds anime that doesn't exist in our DB.

    Args:
        mal_id: MyAnimeList ID
        anilist_id: AniList ID
        title: Anime title (fallback for searching)
    """
    from anime.models import Anime
    from anime.services.anilist import AniListService

    service = AniListService()

    try:
        # Try to fetch by AniList ID first (most reliable)
        if anilist_id:
            logger.info(f"Fetching anime by AniList ID: {anilist_id}")
            # Run async method synchronously
            anime_data = asyncio.run(service.get_anime_by_id(anilist_id))
            if anime_data:
                # Run async save method synchronously  
                anime = asyncio.run(service._save_anime_to_db_async(anime_data))
                logger.info(f"Created/updated anime: {anime.title}")
                return anime.id

        # Try to fetch by MAL ID
        if mal_id:
            logger.info(f"Fetching anime by MAL ID: {mal_id}")
            # Run async method synchronously
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
        import traceback
        traceback.print_exc()
        return None


@shared_task
def cleanup_old_import_jobs(days: int = 30):
    """
    Clean up old import jobs to prevent database bloat

    Args:
        days: Delete jobs older than this many days
    """
    from users.models import UserImportJob

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

    logger.info(f"Cleaned up {count} old import jobs")
    return count
