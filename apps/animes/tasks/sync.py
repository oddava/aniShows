from apps.shared.logger import logger

"""
Unified catalog synchronization task.

Trending is refreshed from the self-hosted Jikan instance, while the remaining
catalog slices are derived from the existing Anime table.
"""

from datetime import datetime

from asgiref.sync import sync_to_async

from apps.animes.services.catalog_sync import CatalogSyncService
from apps.animes.services.jikan import JikanService
from apps.shared.celery import observed_shared_task

from .base import BaseTask, run_async_in_task

SYNC_CONFIGS = {
    "trending": {
        "method": "get_trending_anime_ids",
        "schedule": "hourly",
        "priority": "high",
        "update_ranks": True,
    },
    "seasonal": {
        "method": "get_seasonal_anime_ids",
        "dynamic_season": True,
        "schedule": "daily",
        "priority": "medium",
    },
    "next_season": {
        "method": "get_seasonal_anime_ids",
        "dynamic_season": True,
        "next_season": True,
        "schedule": "weekly",
        "priority": "low",
    },
    "airing": {
        "method": "get_airing_anime_ids",
        "schedule": "hourly",
        "priority": "high",
        "deduplication": True,
    },
    "full_catalog": {
        "method": "get_full_catalog_anime_ids",
        "schedule": "weekly",
        "priority": "low",
        "description": "Refresh a broader local catalog slice from existing rows",
    },
}


class SyncAnimeCatalogTask(BaseTask):
    """Refresh trending from Jikan and other catalog slices from local data."""

    service_class = CatalogSyncService
    service_kwargs = {}
    MIN_TRENDING_RESULTS = 6

    def execute(self, sync_type: str = "trending", limit: int = 50, **kwargs):
        """Run sync based on sync_type."""
        self.metrics.start()

        if sync_type not in SYNC_CONFIGS:
            raise ValueError(f"Unknown sync_type: {sync_type}. Use: {list(SYNC_CONFIGS.keys())}")

        self.sync_type = sync_type
        config = SYNC_CONFIGS[sync_type]
        logger.info("Starting %s sync (limit: %s)", sync_type, limit)

        return run_async_in_task(self._async_sync(sync_type, limit, config, **kwargs))

    async def _async_sync(self, sync_type: str, limit: int, config: dict, **kwargs):
        """Async implementation of sync."""
        if sync_type == "trending":
            task_id = getattr(self.request, "id", None)
            service = JikanService(enable_caching=True, enable_rate_limiting=True)
            try:
                data = await service.get_recent_updates(limit=limit)

                total_items = len(data)

                @sync_to_async
                def update_job_progress(processed, total):
                    if not task_id:
                        return
                    try:
                        from apps.core.models import CeleryTaskResult

                        job = CeleryTaskResult.objects.get(task_id=task_id)
                        if job.result_data is None or not isinstance(job.result_data, dict):
                            job.result_data = {}
                        job.result_data["records_processed"] = processed
                        job.task_kwargs["limit"] = total
                        if job.status == CeleryTaskResult.TaskStatus.PENDING:
                            job.status = CeleryTaskResult.TaskStatus.STARTED
                        job.save(update_fields=["result_data", "task_kwargs", "status"])
                    except Exception:
                        pass

                await update_job_progress(0, total_items)

                if not data:
                    logger.warning("No data returned for %s sync", sync_type)
                    return {"sync_type": sync_type, "status": "no_data"}

                minimum_expected_results = self._minimum_trending_results(limit)
                if total_items < minimum_expected_results:
                    logger.error(
                        "Rejecting %s sync because Jikan returned only %s rows (minimum required: %s)",
                        sync_type,
                        total_items,
                        minimum_expected_results,
                    )
                    return {
                        "sync_type": sync_type,
                        "status": "source_unhealthy",
                        "records_processed": 0,
                        "created": 0,
                        "updated": 0,
                        "matched": 0,
                        "fetched": total_items,
                        "reason": "jikan_result_set_too_small",
                        "minimum_expected": minimum_expected_results,
                    }

                ranked_ids = await self._sync_trending_anime_rows(service, data)
                ranked_count = await sync_to_async(CatalogSyncService().refresh_trending_ranks)(ranked_ids)

                await update_job_progress(total_items, total_items)
                self.metrics.record_records(ranked_count)
                self.metrics.record_api_call("jikan", total_items)

                return {
                    "sync_type": sync_type,
                    "status": "success",
                    "records_processed": total_items,
                    "created": 0,
                    "updated": ranked_count,
                    "matched": len(ranked_ids),
                    "fetched": total_items,
                }
            except Exception as exc:
                logger.error("Error in %s sync: %s", sync_type, exc)
                self.metrics.record_error()
                raise self.retry(exc=exc)
            finally:
                await service.close()

        async with self.service_context() as service:
            try:
                method_name = config["method"]
                method_kwargs = {**kwargs, "limit": limit}

                if config.get("dynamic_season"):
                    season, year = self._get_season(config.get("next_season", False))
                    method_kwargs["season"] = season
                    method_kwargs["year"] = year
                    logger.info("Syncing local %s catalog for %s %s", sync_type, season, year)

                method = getattr(service, method_name)
                anime_ids = await sync_to_async(method)(**method_kwargs)

                task_id = getattr(self.request, "id", None)
                total_items = len(anime_ids)

                @sync_to_async
                def update_job_progress(processed, total):
                    if not task_id:
                        return
                    try:
                        from apps.core.models import CeleryTaskResult

                        job = CeleryTaskResult.objects.get(task_id=task_id)
                        if job.result_data is None or not isinstance(job.result_data, dict):
                            job.result_data = {}
                        job.result_data["records_processed"] = processed
                        job.task_kwargs["limit"] = total
                        if job.status == CeleryTaskResult.TaskStatus.PENDING:
                            job.status = CeleryTaskResult.TaskStatus.STARTED
                        job.save(update_fields=["result_data", "task_kwargs", "status"])
                    except Exception:
                        pass

                await update_job_progress(0, total_items)

                ranked_count = 0
                if config.get("update_ranks"):
                    ranked_count = await sync_to_async(service.refresh_trending_ranks)(anime_ids)

                await update_job_progress(total_items, total_items)
                self.metrics.record_records(total_items)

                if total_items == 0:
                    logger.warning("No local catalog rows matched for %s sync", sync_type)
                    return {
                        "sync_type": sync_type,
                        "status": "no_data",
                        "records_processed": 0,
                        "created": 0,
                        "updated": 0,
                    }

                logger.info(
                    "%s sync complete. Matched: %s, trending ranks updated: %s",
                    sync_type,
                    total_items,
                    ranked_count,
                )

                return {
                    "sync_type": sync_type,
                    "status": "success",
                    "records_processed": total_items,
                    "created": 0,
                    "updated": ranked_count,
                    "matched": total_items,
                }

            except Exception as exc:
                logger.error("Error in %s sync: %s", sync_type, exc)
                self.metrics.record_error()
                raise self.retry(exc=exc)

    def _get_season(self, next_season: bool = False) -> tuple[str, int]:
        """Calculate current or next season."""
        current_date = datetime.now()
        year = current_date.year
        month = current_date.month

        if month in [12, 1, 2]:
            current_season = "WINTER"
            if month == 12:
                year += 1
        elif month in [3, 4, 5]:
            current_season = "SPRING"
        elif month in [6, 7, 8]:
            current_season = "SUMMER"
        else:
            current_season = "FALL"

        if next_season:
            seasons = ["WINTER", "SPRING", "SUMMER", "FALL"]
            idx = seasons.index(current_season)
            next_season_name = seasons[(idx + 1) % 4]

            if current_season == "FALL":
                year += 1

            return next_season_name, year

        return current_season, year

    @staticmethod
    def _minimum_trending_results(limit: int) -> int:
        resolved_limit = max(int(limit or 0), 0)
        if resolved_limit == 0:
            return 0
        return min(resolved_limit, SyncAnimeCatalogTask.MIN_TRENDING_RESULTS)

    async def _sync_trending_anime_rows(
        self,
        service: JikanService,
        items: list[dict],
    ) -> list[int]:
        ranked_ids: list[int] = []
        seen_ids: set[int] = set()

        for item in items:
            if not isinstance(item, dict):
                continue
            mal_id = item.get("idMal")
            if not mal_id:
                continue

            anime = await service._save_anime_to_db_async(item)
            if anime.id in seen_ids:
                continue

            ranked_ids.append(anime.id)
            seen_ids.add(anime.id)

        return ranked_ids


@observed_shared_task(
    base=SyncAnimeCatalogTask,
    retry_policy="standard",
    time_limit=3600,
    soft_time_limit=3300,
)
def sync_anime_catalog(self, sync_type: str = "trending", limit: int = 50, **kwargs):
    """Refresh local catalog slices derived from existing Anime rows."""
    return self.execute(sync_type, limit, **kwargs)
