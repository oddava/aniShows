"""
Unified metadata enrichment task.

Consolidates:
- fetch_deep_metadata
- backfill_metadata_task

With support for:
- Single anime enrichment
- Batch backfill with prioritization
- Deduplication
- Configurable batch sizes
"""

import logging
from typing import Dict, List, Optional
from asgiref.sync import sync_to_async
from celery import shared_task
from django.db.models import Q

from anime.services.anilist import AniListService
from anime.models import Anime
from .base import BaseTask, run_async_in_task

logger = logging.getLogger(__name__)


class MetadataEnrichmentTask(BaseTask):
    """
    Unified task for enriching anime metadata.

    Supports:
    - Single anime deep metadata fetch
    - Batch backfill for anime missing metadata
    - Prioritization by popularity
    - Deduplication via cache

    Usage:
        # Enrich single anime
        enrich_metadata.delay(anime_id=123)

        # Batch backfill (most popular first)
        enrich_metadata.delay(mode='backfill', batch_size=50)

        # Backfill specific anime types
        enrich_metadata.delay(
            mode='backfill',
            batch_size=50,
            filters={'status': 'airing'}
        )
    """

    service_class = AniListService
    service_kwargs = {"enable_caching": True, "enable_rate_limiting": True}

    def run(
        self,
        anime_id: Optional[int] = None,
        mode: str = "single",
        batch_size: int = 50,
        filters: Optional[Dict] = None,
        priority_field: str = "-popularity_rank",
    ):
        """
        Run metadata enrichment.

        Args:
            anime_id: Specific anime ID (for mode='single')
            mode: 'single' or 'backfill'
            batch_size: Maximum anime to process in batch mode
            filters: Optional filters for queryset (e.g., {'status': 'airing'})
            priority_field: Field to order by (default: -popularity_rank)

        Returns:
            Dict with enrichment results
        """
        self.metrics.start()

        if mode == "single" and anime_id:
            return run_async_in_task(self._enrich_single(anime_id))
        elif mode == "backfill":
            return run_async_in_task(
                self._enrich_batch(batch_size, filters, priority_field)
            )
        else:
            raise ValueError(f"Invalid mode: {mode}. Use 'single' or 'backfill'")

    async def _enrich_single(self, anime_id: int) -> Dict:
        """Enrich metadata for a single anime."""
        async with self.service_context() as service:
            try:
                anime = await sync_to_async(Anime.objects.get)(id=anime_id)

                results = await service.search_anime(anime.title)
                if results:
                    await service.update_anime_manual(anime, results[0])
                    logger.info(f"Metadata enriched for {anime.title}")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "success",
                        "title": anime.title,
                    }
                else:
                    logger.warning(f"No results found for {anime.title}")
                    return {
                        "mode": "single",
                        "anime_id": anime_id,
                        "status": "no_results",
                        "title": anime.title,
                    }

            except Anime.DoesNotExist:
                logger.error(f"Anime {anime_id} not found")
                return {
                    "mode": "single",
                    "anime_id": anime_id,
                    "status": "not_found",
                }
            except Exception as e:
                logger.error(f"Error enriching metadata for {anime_id}: {e}")
                raise self.retry(exc=e, countdown=60)

    async def _enrich_batch(
        self,
        batch_size: int,
        filters: Optional[Dict],
        priority_field: str,
    ) -> Dict:
        """Batch enrich metadata for multiple anime."""
        async with self.service_context() as service:
            # Build queryset
            queryset = Anime.objects.filter(
                Q(characters__isnull=True) | Q(staff__isnull=True)
            ).distinct()

            # Apply custom filters
            if filters:
                queryset = queryset.filter(**filters)

            # Apply priority ordering and limit
            queryset = queryset.order_by(priority_field)[:batch_size]

            # Execute query
            anime_list = await sync_to_async(list)(queryset)
            total = len(anime_list)

            if total == 0:
                logger.info("No anime found needing metadata enrichment")
                return {
                    "mode": "backfill",
                    "total": 0,
                    "updated": 0,
                    "errors": 0,
                }

            logger.info(f"Found {total} anime to enrich (batch size: {batch_size})")

            updated_count = 0
            error_count = 0
            no_results_count = 0

            for i, anime in enumerate(anime_list):
                try:
                    # Deduplication check
                    if service.call_cache and service.call_cache.is_recently_updated(
                        anime.anilist_id or 0, window=3600
                    ):
                        logger.debug(f"Skipping {anime.title} - recently updated")
                        continue

                    # Search and update
                    results = await service.search_anime(anime.title)
                    if results:
                        await service.process_media_list([results[0]])
                        updated_count += 1

                        # Mark as updated
                        if service.call_cache and anime.anilist_id:
                            service.call_cache.mark_updated(anime.anilist_id)
                    else:
                        no_results_count += 1
                        logger.warning(f"No results found for {anime.title}")

                    # Progress logging
                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(f"Progress: {i + 1}/{total} anime processed")

                except Exception as e:
                    logger.error(f"Error updating {anime.title}: {e}")
                    error_count += 1

            self.metrics.record_records(updated_count)

            return {
                "mode": "backfill",
                "total": total,
                "updated": updated_count,
                "no_results": no_results_count,
                "errors": error_count,
            }


@shared_task(
    bind=True,
    base=MetadataEnrichmentTask,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    time_limit=7200,  # 2 hours for large batches
    soft_time_limit=6900,
)
def enrich_metadata(
    self,
    anime_id: Optional[int] = None,
    mode: str = "single",
    batch_size: int = 50,
    filters: Optional[Dict] = None,
    priority_field: str = "-popularity_rank",
):
    """
    Enrich anime metadata from AniList.

    Args:
        anime_id: Specific anime ID (for single mode)
        mode: 'single' or 'backfill'
        batch_size: Maximum anime to process
        filters: Optional queryset filters
        priority_field: Field for ordering (default: -popularity_rank)

    Returns:
        Dict with enrichment results
    """
    return self.run(anime_id, mode, batch_size, filters, priority_field)
