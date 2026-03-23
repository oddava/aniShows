from apps.shared.logger import logger

"""
Franchise/Relations synchronization task.
"""

import asyncio

from asgiref.sync import sync_to_async
from celery import shared_task
from django.db.models import Q

from apps.animes.models import Anime
from apps.animes.services.anilist import AniListService

from .base import BaseTask, run_async_in_task


class FranchiseSyncTask(BaseTask):
    """Unified task for syncing anime franchise/relations data."""

    service_class = AniListService
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
            queryset = Anime.objects.filter(
                Q(relations__isnull=True) | Q(relations=[])
            )
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
                        if service.call_cache.is_recently_updated(anime.anilist_id or 0, window=update_window):
                            skipped_count += 1
                            continue

                    result = await self._process_anime_franchises(
                        service, anime, import_missing, max_imports
                    )

                    if result.get("status") == "success":
                        updated_count += 1
                        total_imported += result.get("imported_count", 0)
                        total_linked += result.get("relations_linked", 0)

                        if service.call_cache and anime.anilist_id:
                            service.call_cache.mark_updated(anime.anilist_id)

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
        self, service: AniListService, anime: Anime, import_missing: bool, max_imports: int
    ) -> dict:
        """Process franchises for a single anime."""
        try:
            if not anime.anilist_id:
                return {"status": "error", "error": "No anilist_id", "relations_count": 0}

            data = await service.get_anime_by_id(anime.anilist_id)

            if not data:
                return {"status": "error", "error": "No data from AniList", "relations_count": 0}

            # Extract relations
            relations_data = data.get("relations", {})
            anilist_relations = relations_data.get("edges", [])

            # Filter to only ANIME type
            anime_relations = [
                edge for edge in anilist_relations
                if edge.get("node", {}).get("type") == "ANIME"
            ]

            if not anime_relations:
                anime.relations = []
                await sync_to_async(anime.save)(update_fields=["relations"])
                return {
                    "status": "success",
                    "relations_count": 0,
                    "relations_added": 0,
                    "relations_updated": 0,
                    "relations_linked": 0,
                    "imported_count": 0,
                    "missing_slugs": 0,
                }

            # Get current relations
            current_relations = anime.relations or []
            current_relations_map = {r.get("id"): r for r in current_relations if r.get("id")}

            # Build new relations
            new_relations = []
            for edge in anime_relations:
                node = edge.get("node", {})
                anilist_id = node.get("id")

                title = node.get("title", {}).get("english") or node.get("title", {}).get("romaji") or "Unknown"

                relation_entry = {
                    "id": anilist_id,
                    "type": edge.get("relationType"),
                    "title": title,
                    "format": node.get("format"),
                    "status": node.get("status"),
                    "cover": node.get("coverImage", {}).get("large"),
                    "slug": None,
                }

                # Preserve existing slug
                if anilist_id in current_relations_map:
                    existing_slug = current_relations_map[anilist_id].get("slug")
                    if existing_slug:
                        relation_entry["slug"] = existing_slug

                new_relations.append(relation_entry)

            # Import missing and link slugs
            ids_needing_slugs = {rel["id"] for rel in new_relations if rel.get("slug") is None}
            imported_count = 0

            if import_missing and ids_needing_slugs:
                imported_ids = await self._import_missing_anime_batch(
                    service, anime_relations, ids_needing_slugs, max_imports
                )
                imported_count = len(imported_ids)
                ids_needing_slugs -= imported_ids

            # Link slugs
            all_related_ids = {rel["id"] for rel in new_relations}
            slug_map = await self._get_existing_slugs(all_related_ids)

            relations_linked = 0
            for rel in new_relations:
                rel_id = rel.get("id")
                if rel_id and rel_id in slug_map:
                    rel["slug"] = slug_map[rel_id]
                    relations_linked += 1

            # Save
            anime.relations = new_relations
            await sync_to_async(anime.save)(update_fields=["relations"])

            missing_slugs = len(new_relations) - relations_linked

            return {
                "status": "success",
                "relations_count": len(new_relations),
                "relations_added": len([r for r in new_relations if r["id"] not in current_relations_map]),
                "relations_updated": len([r for r in new_relations if r["id"] in current_relations_map]),
                "relations_linked": relations_linked,
                "imported_count": imported_count,
                "missing_slugs": missing_slugs,
            }

        except Exception as e:
            logger.error(f"Error processing franchises for {anime.title}: {e}", exc_info=True)
            return {"status": "error", "error": str(e), "relations_count": 0}

    async def _get_existing_slugs(self, anilist_ids: set[int]) -> dict[int, str]:
        """Get slug mapping for existing anime by AniList ID."""
        if not anilist_ids:
            return {}

        @sync_to_async
        def fetch_slugs():
            return {
                anime.anilist_id: anime.slug
                for anime in Anime.objects.filter(anilist_id__in=anilist_ids)
                if anime.anilist_id
            }

        return await fetch_slugs()

    async def _import_missing_anime_batch(
        self, service: AniListService, anime_relations: list[dict],
        ids_to_import: set[int], max_imports: int
    ) -> set[int]:
        """Import missing related anime from AniList."""
        imported_ids = set()

        # Build node map
        node_map = {}
        for edge in anime_relations:
            node = edge.get("node", {})
            if node.get("type") == "ANIME":
                node_map[node.get("id")] = node

        for anilist_id in list(ids_to_import)[:max_imports]:
            node = node_map.get(anilist_id)
            if not anilist_id or not node:
                continue

            try:
                # Check if exists
                @sync_to_async
                def check_exists(aid):
                    try:
                        return Anime.objects.get(anilist_id=aid)
                    except Anime.DoesNotExist:
                        return None

                existing = await check_exists(anilist_id)
                if existing:
                    imported_ids.add(anilist_id)
                    continue

                # Fetch and import
                await asyncio.sleep(0.3)
                full_data = await service.get_anime_by_id(anilist_id)

                if full_data:
                    stats = await service.process_media_list([full_data])
                    if stats.get("created", 0) > 0:
                        title = node.get("title", {}).get("english") or node.get("title", {}).get("romaji")
                        logger.info(f"Imported: {title} (ID: {anilist_id})")
                        imported_ids.add(anilist_id)

            except Exception as e:
                logger.warning(f"Could not import ID {anilist_id}: {e}")
                continue

        return imported_ids

@shared_task(
    bind=True,
    base=FranchiseSyncTask,
    max_retries=3,
    default_retry_delay=120,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
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
    """Sync anime franchise/relations data from AniList."""
    return self.execute(
        anime_id=anime_id, mode=mode, batch_size=batch_size,
        import_missing=import_missing, max_imports=max_imports,
        priority_field=priority_field, skip_recently_updated=skip_recently_updated,
        update_window=update_window, anime_ids=anime_ids,
    )

@shared_task(
    bind=True,
    base=FranchiseSyncTask,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    time_limit=1800,
    soft_time_limit=1500,
)
def update_relation_slugs(self, batch_size: int = 100):
    """Update slugs for existing relations."""
    async def _process():
        @sync_to_async
        def get_anime_with_relations():
            return list(
                Anime.objects.exclude(relations__isnull=True)
                .exclude(relations=[])
                .order_by("-popularity_rank")[:batch_size]
            )

        anime_list = await get_anime_with_relations()
        total = len(anime_list)
        updated_count = 0
        linked_count = 0

        for anime in anime_list:
            try:
                relations = anime.relations or []
                needs_update = False
                ids_to_lookup = {rel.get("id") for rel in relations if not rel.get("slug") and rel.get("id")}

                if ids_to_lookup:
                    @sync_to_async
                    def fetch_slugs_batch():
                        return {
                            a.anilist_id: a.slug
                            for a in Anime.objects.filter(anilist_id__in=ids_to_lookup)
                            if a.anilist_id
                        }

                    slug_map = await fetch_slugs_batch()

                    for rel in relations:
                        rel_id = rel.get("id")
                        if not rel.get("slug") and rel_id in slug_map:
                            rel["slug"] = slug_map[rel_id]
                            linked_count += 1
                            needs_update = True

                if needs_update:
                    anime.relations = relations
                    await sync_to_async(anime.save)(update_fields=["relations"])
                    updated_count += 1

            except Exception as e:
                logger.error(f"Error updating {anime.title}: {e}")

        return {"total": total, "updated": updated_count, "linked": linked_count}

    return run_async_in_task(_process())
