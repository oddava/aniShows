"""
Image processing tasks for anime.

Includes thumbnail generation for anime images.
"""
import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    time_limit=300,  # 5 minutes max per anime
)
def generate_image_thumbnails(self, anime_id: int):
    """
    Generate optimized thumbnails for anime images.
    Runs asynchronously to avoid blocking import process.
    Generates WebP thumbnails in small, medium, and large sizes.
    """
    logger.info(f"Starting thumbnail generation for Anime ID: {anime_id}")

    try:
        from apps.anime.models import Anime

        anime = Anime.objects.get(id=anime_id)
        generated_count = 0

        # Generate cover image thumbnails
        if anime.cover_image:
            try:
                # Access each spec field to trigger generation
                _ = anime.cover_image_small.url
                _ = anime.cover_image_medium.url
                _ = anime.cover_image_large.url
                generated_count += 3
                logger.info(f"Generated cover thumbnails for {anime.title}")
            except Exception as e:
                logger.warning(
                    f"Failed to generate cover thumbnails for {anime.title}: {e}"
                )

        # Generate banner image thumbnails
        if anime.banner_image:
            try:
                _ = anime.banner_image_small.url
                _ = anime.banner_image_medium.url
                _ = anime.banner_image_large.url
                generated_count += 3
                logger.info(f"Generated banner thumbnails for {anime.title}")
            except Exception as e:
                logger.warning(
                    f"Failed to generate banner thumbnails for {anime.title}: {e}"
                )

        logger.info(
            f"Thumbnail generation complete for {anime.title}. Generated: {generated_count}"
        )
        return {"anime_id": anime_id, "thumbnails_generated": generated_count}

    except Anime.DoesNotExist:
        logger.error(f"Anime with ID {anime_id} not found")
        return {"status": "error", "reason": "anime_not_found"}
    except Exception as e:
        logger.error(f"Error generating thumbnails for anime {anime_id}: {e}")
        raise self.retry(exc=e, countdown=60)
