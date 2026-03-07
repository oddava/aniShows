from apps.shared.logger import logger
"""
Image processing tasks for anime.

Includes thumbnail generation for anime images.
"""
import httpx
import asyncio
from celery import shared_task
from django.core.files.base import ContentFile
from apps.animes.services.anilist import AniListService
from apps.animes.services.jikan import JIKAN_BASE_URL, JikanRateLimiter

async def _fetch_jikan_fallback_banner(mal_id: int) -> str:
    """Fetch high-res promotional image from Jikan API to use as a banner fallback."""
    if not mal_id:
        return None
        
    limiter = JikanRateLimiter(base_delay=0.35)
    
    for attempt in range(3):
        try:
            await limiter.acquire()
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = f"{JIKAN_BASE_URL}/anime/{mal_id}/pictures"
                response = await client.get(url)
                
                if response.status_code == 429:
                    limiter.record_429()
                    await asyncio.sleep(2 ** attempt)
                    continue
                    
                response.raise_for_status()
                data = response.json().get("data", [])
                
                # Find the largest picture
                for pic in data:
                    large_img = pic.get("webp", {}).get("large_image_url") or pic.get("jpg", {}).get("large_image_url")
                    if large_img:
                        return large_img
                        
        except Exception as e:
            logger.warning(f"Jikan fallback failed for MAL {mal_id}: {e}")
            break
            
    return None

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    time_limit=300,
)
def fetch_anime_images(self, anime_id: int, cover_url: str, banner_url: str, mal_id: int = None):
    """
    Background task to download and save cover/banner images without blocking the main sync loop.
    Implements a Jikan fallback for missing banner images.
    """
    logger.info(f"Starting image fetch for Anime ID: {anime_id}")
    
    from apps.animes.models import Anime
    
    try:
        anime = Anime.objects.get(id=anime_id)
        
        async def _download_job():
            service = AniListService(enable_caching=False, enable_rate_limiting=False)
            
            nonlocal banner_url
            
            # Step 1: Jikan Fallback if no banner from AniList
            if not banner_url and not anime.banner_image and mal_id:
                logger.info(f"No banner for {anime.title}, attempting Jikan fallback...")
                banner_url = await _fetch_jikan_fallback_banner(mal_id)
                if banner_url:
                    # Save external URL reference
                    anime.banner_image_external_url = banner_url
                    await service._save_external_url(anime, "banner_image_external_url", banner_url)
            
            # Step 2: Download the Images natively
            if cover_url and not anime.cover_image:
                cover_data = await service.download_image(cover_url)
                if cover_data:
                    filename = f"{anime.slug}_cover.jpg"
                    await service._save_image(anime, "cover_image", filename, cover_data)

            if banner_url and not anime.banner_image:
                banner_data = await service.download_image(banner_url)
                if banner_data:
                    filename = f"{anime.slug}_banner.jpg"
                    await service._save_image(anime, "banner_image", filename, banner_data)

            await service.close()

        asyncio.run(_download_job())
        
        return {"anime_id": anime_id, "status": "success"}
        
    except Anime.DoesNotExist:
        logger.error(f"Anime with ID {anime_id} not found")
        return {"status": "error", "reason": "anime_not_found"}
    except Exception as e:
        logger.error(f"Error fetching images for anime {anime_id}: {e}")
        raise self.retry(exc=e, countdown=60)

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
        from apps.animes.models import Anime

        anime = Anime.objects.get(id=anime_id)
        generated_count = 0

        # Generate cover image thumbnails
        if anime.cover_image:
            try:
                # Explicitly generate the thumbnails (since we use Optimistic cache strategy)
                anime.cover_image_small.generate()
                anime.cover_image_medium.generate()
                anime.cover_image_large.generate()
                generated_count += 3
                logger.info(f"Generated cover thumbnails for {anime.title}")
            except Exception as e:
                logger.warning(
                    f"Failed to generate cover thumbnails for {anime.title}: {e}"
                )

        # Generate banner image thumbnails
        if anime.banner_image:
            try:
                # Explicitly generate the thumbnails (since we use Optimistic cache strategy)
                anime.banner_image_small.generate()
                anime.banner_image_medium.generate()
                anime.banner_image_large.generate()
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