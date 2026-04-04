from apps.shared.logger import logger

"""
Unified AniList synchronization task.

Consolidates:
- sync_trending_anime
- sync_seasonal_anime
- sync_next_season_anime
- sync_airing_anime

Into a single parameterized task with smart routing.
"""

import asyncio
from datetime import datetime

from asgiref.sync import sync_to_async
from django.db import transaction
from django.db.models import Case, IntegerField, Value, When

from apps.animes.models import Anime
from apps.animes.services.anilist import AniListService, MediaSort
from apps.shared.celery import observed_shared_task

from .base import BaseTask, run_async_in_task

# Explicit airing query: AniListService.anime_query() does not filter by status.
AIRING_MEDIA_QUERY = f"""
    query GetAiringAnime($status: MediaStatus, $page: Int, $perPage: Int, $sort: [MediaSort]) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage }}
            media(type: ANIME, status: $status, sort: $sort) {{
                {AniListService.MEDIA_FIELDS}
            }}
        }}
    }}
"""

# Sync type configurations
SYNC_CONFIGS = {
    "trending": {
        "method": "get_recent_updates",
        "kwargs": {"limit": 50},
        "update_ranks": True,
        "schedule": "hourly",
        "priority": "high",
    },
    "seasonal": {
        "method": "get_by_season",
        "dynamic_season": True,
        "kwargs": {"limit": 100, "sort": MediaSort.POPULARITY},
        "schedule": "daily",
        "priority": "medium",
    },
    "next_season": {
        "method": "get_by_season",
        "dynamic_season": True,
        "next_season": True,
        "kwargs": {"limit": 100, "sort": MediaSort.POPULARITY},
        "schedule": "weekly",
        "priority": "low",
    },
    "airing": {
        "method": "_fetch_paginated",
        "kwargs": {
            "variables": {
                "status": "RELEASING",
                "sort": [MediaSort.POPULARITY.value],
            },
            "custom_query": AIRING_MEDIA_QUERY,
        },
        "schedule": "hourly",
        "priority": "high",
        "deduplication": True,
    },
    "full_catalog": {
        "method": "get_top_rated",
        "kwargs": {"limit": 5000},
        "schedule": "weekly",
        "priority": "low",
        "description": "Fetch top 5000 rated anime to build a broader catalog",
    },
}

class SyncAnimeCatalogTask(BaseTask):
    """Unified task for synchronizing anime catalog from AniList.

    Supports multiple sync types:
    - 'trending': Recently updated/popular anime
    - 'seasonal': Current season anime
    - 'next_season': Upcoming season anime
    - 'airing': All currently airing anime
    - 'full_catalog': Top 5000 rated anime (for building a broader catalog)

    Usage:
        # Sync trending anime
        sync_anime_catalog.delay(sync_type='trending', limit=50)

        # Sync current season
        sync_anime_catalog.delay(sync_type='seasonal')

        # Full catalog sync (manual only, not scheduled due to API limits)
        sync_anime_catalog.delay(sync_type='full_catalog', limit=5000)

        # Chain with other tasks
        chain(
            sync_anime_catalog.s(sync_type='trending'),
            generate_thumbnails.s()
        ).delay()
    """

    service_class = AniListService
    service_kwargs = {"enable_caching": True, "enable_rate_limiting": True}

    def execute(self, sync_type: str = "trending", limit: int = 50, **kwargs):
        """Run sync based on sync_type.

        Args:
            sync_type: One of 'trending', 'seasonal', 'next_season', 'airing'
            limit: Maximum number of anime to sync
            **kwargs: Additional arguments passed to sync method

        Returns:
            Dict with sync statistics
        """
        self.metrics.start()

        if sync_type not in SYNC_CONFIGS:
            raise ValueError(f"Unknown sync_type: {sync_type}. Use: {list(SYNC_CONFIGS.keys())}")

        config = SYNC_CONFIGS[sync_type]
        logger.info(f"Starting {sync_type} sync (limit: {limit})")

        return run_async_in_task(self._async_sync(sync_type, limit, config, **kwargs))

    async def _async_sync(self, sync_type: str, limit: int, config: dict, **kwargs):
        """Async implementation of sync."""
        async with self.service_context() as service:
            try:
                # Determine method parameters
                method_name = config["method"]
                method_kwargs = {**config.get("kwargs", {}), **kwargs}
                if method_name != "_fetch_paginated":
                    method_kwargs["limit"] = limit

                # Handle dynamic season calculation
                if config.get("dynamic_season"):
                    season, year = self._get_season(config.get("next_season", False))
                    method_kwargs["season"] = season
                    method_kwargs["year"] = year
                    logger.info(f"Syncing {season} {year}")

                # Fetch data
                method = getattr(service, method_name)
                if method_name == "_fetch_paginated":
                    # Special handling for paginated fetching
                    data = await self._fetch_paginated_with_limit(service, method_kwargs, limit)
                else:
                    data = await method(**method_kwargs)

                if not data:
                    logger.warning(f"No data returned for {sync_type} sync")
                    return {"sync_type": sync_type, "status": "no_data"}

                # Setup progress callback
                task_id = getattr(self.request, "id", None)
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

                async def progress_callback(processed_count):
                    # Update progress on every item for real-time feedback
                    await update_job_progress(processed_count, total_items)

                # Initialize progress immediately when task starts (0%)
                await update_job_progress(0, total_items)

                # Process data
                stats = await service.process_media_list(data, progress_callback=progress_callback)
                self.metrics.record_records(stats.get("created", 0) + stats.get("updated", 0))

                # Handle trending rank updates
                if config.get("update_ranks"):
                    await self._update_trending_ranks(data)

                # Trigger theme sync for newly created anime
                created_anime_ids = stats.get("created_anime_ids", [])
                if created_anime_ids:
                    logger.info(f"Triggering theme sync for {len(created_anime_ids)} new anime")
                    await self._trigger_theme_sync_for_new_anime(created_anime_ids)

                # Record API calls
                self.metrics.record_api_call("anilist", len(data))

                logger.info(
                    f"{sync_type.capitalize()} sync complete. "
                    f"Created: {stats['created']}, Updated: {stats['updated']}"
                )

                return {
                    "sync_type": sync_type,
                    "status": "success",
                    "records_processed": len(data),
                    **stats,
                }

            except Exception as e:
                logger.error(f"Error in {sync_type} sync: {e}")
                self.metrics.record_error()
                raise self.retry(exc=e)

    async def _fetch_paginated_with_limit(self, service, method_kwargs, limit):
        """Fetch paginated data up to limit."""
        all_data = []
        page = 1

        while len(all_data) < limit:
            method_kwargs["variables"]["page"] = page
            data = await service._fetch_paginated(**method_kwargs, limit=50)

            if not data:
                break

            all_data.extend(data)
            page += 1

            # Circuit breaker check
            if not service._check_circuit_breaker():
                logger.error("Circuit breaker open - stopping pagination")
                break

        return all_data[:limit]

    def _get_season(self, next_season: bool = False) -> tuple:
        """Calculate current or next season.

        Returns:
            Tuple of (season_name, year)
        """
        current_date = datetime.now()
        year = current_date.year
        month = current_date.month

        # Determine current season
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

        # Calculate next season if requested
        if next_season:
            seasons = ["WINTER", "SPRING", "SUMMER", "FALL"]
            idx = seasons.index(current_season)
            next_idx = (idx + 1) % 4
            next_season_name = seasons[next_idx]

            if current_season == "FALL":
                year += 1

            return next_season_name, year

        return current_season, year

    async def _update_trending_ranks(self, data: list[dict]):
        """Batch update trending ranks using AniList ID."""
        rank_updates = {}
        for i, item in enumerate(data):
            anilist_id = item.get("id")
            if anilist_id:
                rank_updates[anilist_id] = i + 1

        @sync_to_async
        def batch_update():
            with transaction.atomic():
                Anime.objects.filter(trending_rank__isnull=False).update(trending_rank=None)
                if not rank_updates:
                    return
                Anime.objects.filter(anilist_id__in=rank_updates).update(
                    trending_rank=Case(
                        *[When(anilist_id=aid, then=Value(rank)) for aid, rank in rank_updates.items()],
                        default=Value(None),
                        output_field=IntegerField(),
                    )
                )

        await batch_update()
        logger.info(f"Updated {len(rank_updates)} trending ranks")

    async def _trigger_theme_sync_for_new_anime(self, anime_ids: list[int]):
        """Trigger theme sync for newly created anime.
        Uses Jikan API to fetch opening and ending themes.
        """
        from apps.animes.tasks import sync_theme_songs

        logger.info(f"Queueing theme sync for {len(anime_ids)} new anime")

        # Create a group of tasks to sync themes in parallel
        # Use chunks to avoid overwhelming the queue
        chunk_size = 10
        for i in range(0, len(anime_ids), chunk_size):
            chunk = anime_ids[i : i + chunk_size]
            logger.info(f"Queueing theme sync chunk {i // chunk_size + 1}: {len(chunk)} anime")

            # Queue individual theme sync tasks
            for anime_id in chunk:
                try:
                    await sync_to_async(sync_theme_songs.delay)(anime_id=anime_id)
                    logger.debug(f"Queued theme sync for anime ID: {anime_id}")
                except Exception as e:
                    logger.error(f"Failed to queue theme sync for anime {anime_id}: {e}")

            # Small delay between chunks to avoid rate limiting
            if i + chunk_size < len(anime_ids):
                await asyncio.sleep(0.5)

        logger.info(f"Theme sync queued for all {len(anime_ids)} new anime")

@observed_shared_task(
    base=SyncAnimeCatalogTask,
    retry_policy="standard",
    time_limit=3600,
    soft_time_limit=3300,
)
def sync_anime_catalog(self, sync_type: str = "trending", limit: int = 50, **kwargs):
    """Unified task for syncing anime catalog from AniList.

    Args:
        sync_type: 'trending', 'seasonal', 'next_season', or 'airing'
        limit: Maximum records to process
        **kwargs: Additional sync parameters

    Returns:
        Dict with sync statistics
    """
    return self.execute(sync_type, limit, **kwargs)
