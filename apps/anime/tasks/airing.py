"""
Unified airing workflow task.

Consolidates:
- sync_airing_anime
- cleanup_finished_airing_dates
- backfill_airing_dates

Into a chained workflow with smart deduplication and batching.
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional
from asgiref.sync import sync_to_async
from celery import shared_task, chain, chord
from django.utils import timezone

from apps.anime.services.anilist import AniListService
from apps.anime.services.rate_limiting import APICallCache
from apps.anime.models import Anime
from .base import BaseTask, run_async_in_task

logger = logging.getLogger(__name__)


class AiringWorkflowTask(BaseTask):
    """
    Unified workflow for managing airing anime data.

    This task chains multiple operations:
    1. Sync airing anime (update next_airing_date for all airing anime)
    2. Cleanup finished anime (clear dates for finished anime)
    3. Backfill missing dates (find anime missing next_airing_date)

    Usage:
        # Run full workflow
        sync_airing_workflow.delay()

        # Run specific phases
        sync_airing_workflow.delay(phases=['sync', 'cleanup'])

        # Run with custom batch size
        sync_airing_workflow.delay(batch_size=200)
    """

    service_class = AniListService
    service_kwargs = {"enable_caching": True, "enable_rate_limiting": True}

    def execute(
        self,
        phases: Optional[List[str]] = None,
        batch_size: int = 100,
        dedup_window: int = 1800,
    ):
        """
        Run airing workflow.

        Args:
            phases: List of phases to run ['sync', 'cleanup', 'backfill'] or None for all
            batch_size: Maximum anime to process per phase
            dedup_window: Deduplication window in seconds

        Returns:
            Dict with workflow results
        """
        self.metrics.start()

        if phases is None:
            phases = ["sync", "cleanup", "backfill"]

        logger.info(f"Starting airing workflow with phases: {phases}")

        return run_async_in_task(self._async_workflow(phases, batch_size, dedup_window))

    async def _async_workflow(
        self,
        phases: List[str],
        batch_size: int,
        dedup_window: int,
    ):
        """Async workflow implementation."""
        results = {}

        async with self.service_context() as service:
            # Initialize deduplication cache
            call_cache = APICallCache(ttl=dedup_window)

            # Phase 1: Sync airing anime
            if "sync" in phases:
                logger.info("Phase 1: Syncing airing anime")
                results["sync"] = await self._sync_airing(
                    service, call_cache, batch_size
                )

            # Phase 2: Cleanup finished
            if "cleanup" in phases:
                logger.info("Phase 2: Cleaning up finished anime")
                results["cleanup"] = await self._cleanup_finished(service, batch_size)

            # Phase 3: Backfill missing
            if "backfill" in phases:
                logger.info("Phase 3: Backfilling missing dates")
                results["backfill"] = await self._backfill_missing(
                    service, call_cache, batch_size
                )

        self.metrics.stop()

        # Compile summary
        summary = self._compile_summary(results)
        logger.info(f"Airing workflow complete: {summary}")

        return summary

    async def _sync_airing(
        self,
        service: AniListService,
        call_cache: APICallCache,
        batch_size: int,
    ) -> Dict:
        """
        Sync all currently airing anime.

        Updates next_airing_date for anime with status='airing'.
        Uses deduplication to prevent redundant API calls.
        """
        # Get airing anime with AniList IDs
        airing_anime = await sync_to_async(list)(
            Anime.objects.filter(status=Anime.AnimeStatus.airing).exclude(
                anilist_id__isnull=True
            )[:batch_size]
        )

        total = len(airing_anime)
        if total == 0:
            logger.info("No airing anime found to sync")
            return {"total": 0, "updated": 0, "skipped": 0, "errors": 0}

        logger.info(f"Found {total} airing anime to sync")

        updated_count = 0
        skipped_count = 0
        missing_date_count = 0
        error_count = 0

        for i, anime in enumerate(airing_anime):
            try:
                # Deduplication check
                if call_cache.is_recently_updated(anime.anilist_id, window=1800):
                    skipped_count += 1
                    continue

                # Fetch and update
                result = await service.get_anime_by_id(anime.anilist_id)

                if result:
                    await service.update_anime_manual(anime, result)

                    # Check if we got airing date
                    next_airing = result.get("nextAiringEpisode")
                    if not next_airing or not next_airing.get("airingAt"):
                        missing_date_count += 1

                    updated_count += 1
                    call_cache.mark_updated(anime.anilist_id)
                else:
                    logger.warning(f"No results for anime ID: {anime.anilist_id}")

                # Progress logging
                if (i + 1) % 10 == 0 or (i + 1) == total:
                    logger.info(
                        f"Sync progress: {i + 1}/{total} "
                        f"(updated: {updated_count}, skipped: {skipped_count})"
                    )

            except Exception as e:
                logger.error(f"Error updating {anime.title}: {e}")
                error_count += 1

        self.metrics.record_api_call("anilist", updated_count)
        self.metrics.record_records(updated_count)

        return {
            "total": total,
            "updated": updated_count,
            "skipped": skipped_count,
            "missing_dates": missing_date_count,
            "errors": error_count,
        }

    async def _cleanup_finished(
        self,
        service: AniListService,
        batch_size: int,
    ) -> Dict:
        """
        Clear next_airing_date for finished anime.

        Also updates status from 'airing' to 'finished' if detected.
        """
        # Find anime with past airing dates
        past_airing = await sync_to_async(list)(
            Anime.objects.filter(
                next_airing_date__isnull=False,
                next_airing_date__lt=timezone.now(),
            ).exclude(anilist_id__isnull=True)[:batch_size]
        )

        cleared_count = 0
        status_changed_count = 0
        error_count = 0

        for anime in past_airing:
            try:
                result = await service.get_anime_by_id(anime.anilist_id)

                if result:
                    anilist_status = result.get("status", "")

                    if anilist_status == "FINISHED":
                        # Batch clear in single save
                        anime.next_airing_date = None
                        anime.next_airing_episode = None
                        anime.status = Anime.AnimeStatus.finished
                        await sync_to_async(anime.save)()
                        cleared_count += 1
                        status_changed_count += 1
                        logger.debug(f"Updated {anime.title} to Finished")
                    elif anilist_status == "RELEASING":
                        # Episode aired but still releasing
                        anime.next_airing_date = None
                        anime.next_airing_episode = None
                        await sync_to_async(anime.save)()
                        cleared_count += 1

            except Exception as e:
                logger.error(f"Error cleaning up {anime.title}: {e}")
                error_count += 1

        # Batch clear for explicitly finished anime
        finished_with_dates = await sync_to_async(
            Anime.objects.filter(
                status=Anime.AnimeStatus.finished,
                next_airing_date__isnull=False,
            ).update
        )(
            next_airing_date=None,
            next_airing_episode=None,
        )

        return {
            "cleared_past_dates": cleared_count,
            "status_changed": status_changed_count,
            "finished_cleaned": finished_with_dates,
            "errors": error_count,
        }

    async def _backfill_missing(
        self,
        service: AniListService,
        call_cache: APICallCache,
        batch_size: int,
    ) -> Dict:
        """
        Backfill missing next_airing_date for airing anime.

        Processes anime with status='airing' but no next_airing_date.
        """
        missing_dates = await sync_to_async(list)(
            Anime.objects.filter(
                status=Anime.AnimeStatus.airing,
                next_airing_date__isnull=True,
            ).exclude(anilist_id__isnull=True)[:batch_size]
        )

        total = len(missing_dates)
        if total == 0:
            logger.info("No anime with missing airing dates found")
            return {"total": 0, "populated": 0, "still_missing": 0, "errors": 0}

        logger.info(f"Found {total} airing anime missing next_airing_date")

        updated_count = 0
        still_missing_count = 0
        error_count = 0

        for i, anime in enumerate(missing_dates):
            try:
                result = await service.get_anime_by_id(anime.anilist_id)

                if result:
                    await service.update_anime_manual(anime, result)

                    next_airing = result.get("nextAiringEpisode")
                    if next_airing and next_airing.get("airingAt"):
                        updated_count += 1
                        logger.debug(f"Populated date for: {anime.title}")
                    else:
                        still_missing_count += 1
                else:
                    logger.warning(f"No AniList data for: {anime.title}")

                if (i + 1) % 10 == 0 or (i + 1) == total:
                    logger.info(f"Backfill progress: {i + 1}/{total}")

            except Exception as e:
                logger.error(f"Error backfilling {anime.title}: {e}")
                error_count += 1

        return {
            "total": total,
            "populated": updated_count,
            "still_missing": still_missing_count,
            "errors": error_count,
        }

    def _compile_summary(self, results: Dict) -> Dict:
        """Compile workflow results into summary."""
        summary = {
            "status": "success",
            "phases_completed": list(results.keys()),
            "metrics": self.metrics.to_dict(),
        }

        # Add phase summaries
        if "sync" in results:
            summary["sync_summary"] = {
                "total": results["sync"]["total"],
                "updated": results["sync"]["updated"],
                "skipped": results["sync"]["skipped"],
                "missing_dates": results["sync"]["missing_dates"],
            }

        if "cleanup" in results:
            summary["cleanup_summary"] = {
                "cleared": results["cleanup"]["cleared_past_dates"],
                "status_changed": results["cleanup"]["status_changed"],
                "batch_cleared": results["cleanup"]["finished_cleaned"],
            }

        if "backfill" in results:
            summary["backfill_summary"] = {
                "total": results["backfill"]["total"],
                "populated": results["backfill"]["populated"],
                "still_missing": results["backfill"]["still_missing"],
            }

        return summary


@shared_task(
    bind=True,
    base=AiringWorkflowTask,
    max_retries=3,
    default_retry_delay=120,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    time_limit=3600,
    soft_time_limit=3300,
)
def sync_airing_workflow(
    self,
    phases: Optional[List[str]] = None,
    batch_size: int = 100,
    dedup_window: int = 1800,
):
    """
    Run unified airing workflow.

    Args:
        phases: Phases to run ['sync', 'cleanup', 'backfill'] or None for all
        batch_size: Maximum anime per phase
        dedup_window: Deduplication window in seconds

    Returns:
        Dict with workflow summary
    """
    return self.execute(phases, batch_size, dedup_window)
