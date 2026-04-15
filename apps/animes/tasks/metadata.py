from ...shared.logger import logger

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

from asgiref.sync import sync_to_async

from ...shared.celery import observed_shared_task
from ..models import Anime
from ..services.jikan import JikanService
from ..services.metadata_health import build_missing_metadata_query
from .base import BaseTask, run_async_in_task


class MetadataEnrichmentTask(BaseTask):
    """Unified task for enriching anime metadata.

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

    service_class = JikanService
    service_kwargs = {"enable_caching": True, "enable_rate_limiting": True}

    def execute(
        self,
        anime_id: int | None = None,
        mode: str = "single",
        batch_size: int = 50,
        filters: dict | None = None,
        priority_field: str = "-popularity_rank",
        anime_ids: list[int] | None = None,
        missing_tags_only: bool = False,
    ):
        """Run metadata enrichment.

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
                self._enrich_batch(
                    batch_size,
                    filters,
                    priority_field,
                    anime_ids,
                    missing_tags_only,
                )
            )
        else:
            raise ValueError(f"Invalid mode: {mode}. Use 'single' or 'backfill'")

    async def _enrich_single(self, anime_id: int) -> dict:
        """Enrich metadata for a single anime."""
        async with self.service_context() as service:
            try:
                anime = await sync_to_async(Anime.objects.get)(id=anime_id)

                media = await self._resolve_media_for_anime(service, anime)
                if media:
                    updated = await service.refresh_anime_metadata(anime, media)
                    if not updated:
                        logger.warning(
                            f"Skipped metadata enrichment for {anime.title} due to identity mismatch"
                        )
                        return {
                            "mode": "single",
                            "anime_id": anime_id,
                            "status": "skipped_conflict",
                            "title": anime.title,
                        }

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

    async def _resolve_media_for_anime(
        self, service: JikanService, anime: Anime
    ) -> dict | None:
        """Resolve the best Jikan media payload for a local Anime row."""
        return await service.resolve_media_for_anime(anime)

    async def _enrich_batch(
        self,
        batch_size: int,
        filters: dict | None,
        priority_field: str,
        anime_ids: list[int] | None,
        missing_tags_only: bool,
    ) -> dict:
        """Batch enrich metadata for multiple anime."""
        async with self.service_context() as service:
            missing_metadata_query = build_missing_metadata_query(
                missing_tags_only=missing_tags_only
            )

            if anime_ids:
                # Explicit IDs are passed by workflows like offline import; process all of them.
                queryset = Anime.objects.filter(id__in=anime_ids)
                if missing_tags_only:
                    queryset = queryset.filter(tags=[])
            else:
                queryset = Anime.objects.filter(missing_metadata_query).distinct()

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
                    "missing_tags_only": missing_tags_only,
                }

            logger.info(f"Found {total} anime to enrich (batch size: {batch_size})")

            updated_count = 0
            error_count = 0
            no_results_count = 0
            skipped_conflicts_count = 0

            for i, anime in enumerate(anime_list):
                try:
                    # Deduplication check
                    if service.call_cache and service.call_cache.is_recently_updated(
                        anime.anilist_id or 0, window=3600
                    ):
                        logger.debug(f"Skipping {anime.title} - recently updated")
                        continue

                    # Search and update
                    media = await self._resolve_media_for_anime(service, anime)
                    if media:
                        updated = await service.refresh_anime_metadata(anime, media)
                        if updated:
                            updated_count += 1

                            # Mark as updated
                            if service.call_cache and anime.anilist_id:
                                service.call_cache.mark_updated(anime.anilist_id)
                        else:
                            skipped_conflicts_count += 1
                            logger.warning(
                                f"Skipped update for {anime.title} due to identity mismatch"
                            )
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
                "skipped_conflicts": skipped_conflicts_count,
                "errors": error_count,
                "missing_tags_only": missing_tags_only,
            }

@observed_shared_task(
    base=MetadataEnrichmentTask,
    retry_policy="standard",
    time_limit=7200,  # 2 hours for large batches
    soft_time_limit=6900,
)
def enrich_metadata(
    self,
    anime_id: int | None = None,
    mode: str = "single",
    batch_size: int = 50,
    filters: dict | None = None,
    priority_field: str = "-popularity_rank",
    anime_ids: list[int] | None = None,
    missing_tags_only: bool = False,
):
    """Enrich anime metadata from Jikan.

    Args:
        anime_id: Specific anime ID (for single mode)
        mode: 'single' or 'backfill'
        batch_size: Maximum anime to process
        filters: Optional queryset filters
        priority_field: Field for ordering (default: -popularity_rank)

    Returns:
        Dict with enrichment results
    """
    return self.execute(
        anime_id,
        mode,
        batch_size,
        filters,
        priority_field,
        anime_ids,
        missing_tags_only,
    )
