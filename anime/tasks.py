
from celery import shared_task
import asyncio
from datetime import datetime
from .services.anilist import AniListService, MediaSort
from .models import Anime
from asgiref.sync import sync_to_async
import logging

logger = logging.getLogger(__name__)

# Helper to run async code in sync celery task
def run_async(coro):
    return asyncio.run(coro)

@shared_task
def sync_trending_anime(limit=50):
    """
    Fetches the currently trending anime.
    Useful for keeping updated with currently airing shows (episodes, scores).
    Run this frequently (e.g. hourly).
    """
    logger.info(f"Starting trending anime sync (limit: {limit})")
    
    async def _process():
        service = AniListService()
        try:
            data = await service.get_recent_updates(limit=limit)
            stats = await service.process_media_list(data)
            logger.info(f"Trending Sync Complete. Created: {stats['created']}, Updated: {stats['updated']}")
            return stats
        finally:
            await service.close()

    return run_async(_process())

@shared_task
def sync_seasonal_anime(limit=100):
    """
    Fetches anime for the current season.
    Run this daily.
    """
    current_date = datetime.now()
    year = current_date.year
    month = current_date.month
    
    # Determine season
    if month in [12, 1, 2]:
        season = "WINTER"
        if month == 12: year += 1 # Season starts in Dec implies next year's winter season usually
    elif month in [3, 4, 5]:
        season = "SPRING"
    elif month in [6, 7, 8]:
        season = "SUMMER"
    else:
        season = "FALL"
        
    logger.info(f"Starting seasonal sync for {season} {year}")

    async def _process():
        service = AniListService()
        try:
            data = await service.get_by_season(season, year, limit=limit, sort=MediaSort.POPULARITY)
            stats = await service.process_media_list(data)
            logger.info(f"Seasonal Sync Complete. Stats: {stats}")
            return stats
        finally:
            await service.close()
            
    return run_async(_process())

@shared_task
def backfill_catalog(start_page=1, pages=5):
    """
    Scrapes the entire catalog page by page to fill in older anime.
    Can be chained to run continuously if needed, but safer to run in chunks.
    """
    logger.info(f"Starting catalog backfill from page {start_page} for {pages} pages")
    
    async def _process():
        service = AniListService()
        try:
            # We construct a custom fetch here to just iterate pages
            total_stats = {'created': 0, 'updated': 0, 'skipped': 0}
            
            for page in range(start_page, start_page + pages):
                logger.info(f"Backfilling Page {page}...")
                data = await service._fetch_paginated(
                    variables={"page": page, "sort": [MediaSort.ID_DESC.value]}, # Newest IDs first
                    limit=50 # Per page fetch
                )
                if not data:
                    break
                    
                stats = await service.process_media_list(data)
                total_stats['created'] += stats['created']
                total_stats['updated'] += stats['updated']
                total_stats['skipped'] += stats['skipped']
            
            logger.info(f"Backfill Chunk Complete. Total Stats: {total_stats}")
            return total_stats
        finally:
            await service.close()

    return run_async(_process())


@shared_task
def backfill_metadata_task():
    """
    Backfills metadata for existing anime using a background Celery task.
    """
    logger.info("Starting metadata backfill task...")
    
    async def _process():
        service = AniListService()
        try:
            # Get all anime from DB that donor't have characters AND staff
            # This identifies anime that haven't been backfilled yet
            all_anime = await sync_to_async(list)(
                Anime.objects.filter(characters__isnull=True, staff__isnull=True)
                .distinct()
                .order_by('-popularity_rank')
            )
            total = len(all_anime)
            logger.info(f"Found {total} newly imported anime to update.")
            
            updated_count = 0
            error_count = 0

            for i, anime in enumerate(all_anime):
                try:
                    results = await service.search_anime(anime.title)
                    if results:
                        item = results[0]
                        await service.process_media_list([item])
                        updated_count += 1
                        if (i + 1) % 10 == 0 or (i + 1) == total:
                            logger.info(f"Progress: {i + 1}/{total} anime updated.")
                    else:
                        logger.warning(f"No results found for {anime.title}")
                except Exception as e:
                    logger.error(f"Error updating {anime.title}: {e}")
                    error_count += 1
                
                # Small base delay between processed items (the service handles API rate limits)
                await asyncio.sleep(0.5) 

            logger.info(f"Backfill Complete. Updated: {updated_count}, Total: {total}, Errors: {error_count}")
        finally:
            await service.close()

    return run_async(_process())
