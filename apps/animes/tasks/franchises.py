from ...shared.logger import logger

"""
Franchise/Relations synchronization task.
"""

import asyncio

from asgiref.sync import sync_to_async

from ...shared.celery import observed_shared_task
from ..models import Anime
from ..services.jikan import JikanService
from ..services.relation_links import (
    anime_relation_edges,
    link_pending_relations,
    relations_from_edges,
    set_relations,
)
from .base import BaseTask, run_async_in_task


class FranchiseSyncTask(BaseTask):
    """Unified task for syncing anime franchise/relations data."""

    service_class = JikanService
    service_kwargs = {"enable_caching": True, "enable_rate_limiting": True}

    def execute(
        self,
        anime_id: int | None = None,
        mode: str = "single",
        batch_size: int = 50,
        import_missing: bool = True,
        max_imports: int = 10,
        priority_field: str = "-popularity_rank",
        skip_recently_updated: bool = True,
        update_window: int = 3600,
        anime_ids: list[int] | None = None,
    ):
        """Run franchise sync."""
        self.metrics.start()

        if mode == "single" and anime_id:
            return run_async_in_task(
                self._sync_single(anime_id, import_missing, max_imports)
            )
        elif mode == "backfill":
            return run_async_in_task(
                self._sync_batch(
                    batch_size, import_missing, max_imports, priority_field,
                    skip_recently_updated, update_window, anime_ids
                )
            )
        else:
            raise ValueError(f"Invalid mode: {mode}")

    async def _sync_single(self, anime_id: int, import_missing: bool, max_imports: int) -> dict:
        """Sync franchises for a single anime."""
        async with self.service_context() as service:
            try:
                anime = await sync_to_async(Anime.objects.get)(id=anime_id)
                result = await self._process_anime_franchises(
                    service, anime, import_missing, max_imports
                )
                self.metrics.record_records(1)
                return {"mode": "single", "anime_id": anime_id, "title": anime.title, **result}
            except Anime.DoesNotExist:
                logger.error(f"Anime {anime_id} not found")
                return {"mode": "single", "anime_id": anime_id, "status": "not_found"}
            except Exception as e:
                logger.error(f"Error syncing franchises for anime {anime_id}: {e}")
                raise self.retry(exc=e, countdown=60)

    async def _sync_batch(
        self, batch_size: int, import_missing: bool, max_imports: int,
        priority_field: str, skip_recently_updated: bool, update_window: int,
        anime_ids: list[int] | None,
    ) -> dict:
        """Batch sync franchises for multiple anime."""
        async with self.service_context() as service:
            queryset = Anime.objects.filter(relations__isnull=True)
            if anime_ids:
                queryset = queryset.filter(id__in=anime_ids)
            queryset = queryset.order_by(priority_field)[:batch_size]

            anime_list = await sync_to_async(list)(queryset)
            total = len(anime_list)

            if total == 0:
                logger.info("No anime found needing franchise sync")
                return {"mode": "backfill", "total": 0, "processed": 0, "updated": 0}

            logger.info(f"Found {total} anime to sync franchises")

            updated_count = 0
            error_count = 0
            skipped_count = 0
            total_imported = 0
            total_linked = 0

            for i, anime in enumerate(anime_list):
                try:
                    if skip_recently_updated and service.call_cache:
                        if service.call_cache.is_recently_updated(anime.mal_id or 0, window=update_window):
                            skipped_count += 1
                            continue

                    result = await self._process_anime_franchises(
                        service, anime, import_missing, max_imports
                    )

                    if result.get("status") == "success":
                        updated_count += 1
                        total_imported += result.get("imported_count", 0)
                        total_linked += result.get("relations_linked", 0)

                        if service.call_cache and anime.mal_id:
                            service.call_cache.mark_updated(anime.mal_id)

                        logger.info(
                            f"✓ ({i+1}/{total}) {anime.title}: "
                            f"{result.get('relations_count', 0)} rels, "
                            f"{result.get('relations_linked', 0)} linked, "
                            f"{result.get('imported_count', 0)} imported"
                        )
                    else:
                        error_count += 1
                        logger.warning(f"⚠ ({i+1}/{total}) {anime.title}: {result.get('error')}")

                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        logger.info(f"Progress: {i+1}/{total} (updated: {updated_count}, skipped: {skipped_count}, errors: {error_count})")

                except Exception as e:
                    error_count += 1
                    logger.error(f"✗ Error processing {anime.title}: {e}")
                    continue

            return {
                "mode": "backfill",
                "total": total,
                "processed": updated_count + error_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "errors": error_count,
                "imported": total_imported,
                "linked": total_linked,
            }

    async def _process_anime_franchises(
        self, service: JikanService, anime: Anime, import_missing: bool, max_imports: int
    ) -> dict:
        """Process franchises for a single anime."""
        try:
            if not anime.mal_id:
                return {"status": "error", "error": "No mal_id", "relations_count": 0}

            data = await service.search_by_mal_id(anime.mal_id, anilist_id=anime.anilist_id)

            if not data:
                return {"status": "error", "error": "No data from Jikan", "relations_count": 0}

            current_keys = await sync_to_async(self._relation_keys)(anime)
            await sync_to_async(set_relations)(
                anime, relations_from_edges(anime_relation_edges(data))
            )

            imported_count = 0
            if import_missing:
                # Imported anime link themselves to these relations when saved.
                missing_mal_ids = await sync_to_async(list)(
                    anime.relations.filter(
                        to_anime__isnull=True, target_mal_id__isnull=False
                    ).values_list("target_mal_id", flat=True)
                )
                imported_count = await self._import_missing_anime_batch(
                    service, missing_mal_ids, max_imports
                )

            rows = await sync_to_async(list)(
                anime.relations.values_list("target_anilist_id", "target_mal_id", "to_anime_id")
            )
            relations_linked = sum(1 for *_, to_anime_id in rows if to_anime_id)
            relations_added = sum(
                1
                for anilist_id, mal_id, _ in rows
                if ("anilist", anilist_id) not in current_keys
                and ("mal", mal_id) not in current_keys
            )
            return {
                "status": "success",
                "relations_count": len(rows),
                "relations_added": relations_added,
                "relations_updated": len(rows) - relations_added,
                "relations_linked": relations_linked,
                "imported_count": imported_count,
                "missing_slugs": len(rows) - relations_linked,
            }

        except Exception as e:
            logger.error(f"Error processing franchises for {anime.title}: {e}", exc_info=True)
            return {"status": "error", "error": str(e), "relations_count": 0}

    @staticmethod
    def _relation_keys(anime: Anime) -> set[tuple[str, int]]:
        keys = set()
        for anilist_id, mal_id in anime.relations.values_list(
            "target_anilist_id", "target_mal_id"
        ):
            if anilist_id:
                keys.add(("anilist", anilist_id))
            if mal_id:
                keys.add(("mal", mal_id))
        return keys

    async def _import_missing_anime_batch(
        self, service: JikanService, mal_ids: list[int], max_imports: int
    ) -> int:
        """Import related anime that are not in the catalog yet. Returns how many were created."""
        imported = 0
        for mal_id in list(dict.fromkeys(mal_ids))[:max_imports]:
            try:
                exists = await sync_to_async(Anime.objects.filter(mal_id=mal_id).exists)()
                if exists:
                    continue

                await asyncio.sleep(0.3)
                full_data = await service.search_by_mal_id(mal_id)
                if full_data:
                    anime = await service._save_anime_to_db_async(full_data)
                    logger.info(f"Imported: {anime.title} (MAL ID: {mal_id})")
                    imported += 1
            except Exception as e:
                logger.warning(f"Could not import MAL ID {mal_id}: {e}")
                continue

        return imported

@observed_shared_task(
    base=FranchiseSyncTask,
    retry_policy="standard",
    time_limit=3600,
    soft_time_limit=3300,
)
def sync_franchises(
    self,
    anime_id: int | None = None,
    mode: str = "single",
    batch_size: int = 50,
    import_missing: bool = True,
    max_imports: int = 10,
    priority_field: str = "-popularity_rank",
    skip_recently_updated: bool = True,
    update_window: int = 3600,
    anime_ids: list[int] | None = None,
):
    """Sync anime franchise/relations data from Jikan."""
    return self.execute(
        anime_id=anime_id, mode=mode, batch_size=batch_size,
        import_missing=import_missing, max_imports=max_imports,
        priority_field=priority_field, skip_recently_updated=skip_recently_updated,
        update_window=update_window, anime_ids=anime_ids,
    )

@observed_shared_task(
    base=FranchiseSyncTask,
    retry_policy="standard",
    time_limit=1800,
    soft_time_limit=1500,
)
def update_relation_slugs(self, batch_size: int = 100):
    """Link relations whose target anime has been imported since.

    ``batch_size`` is unused (linking is one set-based update); kept for queued calls.
    """
    return {"linked": link_pending_relations()}
