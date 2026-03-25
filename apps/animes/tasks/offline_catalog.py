from celery import shared_task
from django.db.models import Count

from apps.animes.models import Anime
from apps.animes.services.offline_catalog import (
    DEFAULT_ASSET_NAME,
    PLACEHOLDER_SYNOPSIS,
    OfflineCatalogImportService,
)
from apps.shared.logger import logger

from .base import BaseTask


class OfflineCatalogImportTask(BaseTask):
    enable_locking = True
    lock_timeout = 7200

    def execute(
        self,
        release_tag: str = "latest",
        asset_name: str = DEFAULT_ASSET_NAME,
        source_url: str | None = None,
        source_path: str | None = None,
        limit: int | None = None,
        resume: bool = False,
        enqueue_enrichment: bool = False,
        enforce_full_sync: bool = True,
        batch_size: int = 250,
        enrichment_chunk_size: int = 100,
    ):
        self.metrics.start()
        service = OfflineCatalogImportService(
            batch_size=batch_size,
            enrichment_chunk_size=enrichment_chunk_size,
        )
        result = service.run_import(
            release_tag=release_tag,
            asset_name=asset_name,
            source_url=source_url,
            source_path=source_path,
            limit=limit,
            resume=resume,
            enqueue_enrichment=enqueue_enrichment,
        )
        if enforce_full_sync and enqueue_enrichment:
            reconcile_offline_catalog_sync.delay(
                anime_ids=[],
                strict=False,
                max_rounds=24,
                round_number=1,
                round_interval_minutes=15,
                batch_size=500,
                chunk_size=enrichment_chunk_size,
                require_themes=True,
            )
        self.metrics.record_records(result.get("records_seen", 0))
        return result


class OfflineCatalogReconcileSyncTask(BaseTask):
    """Reconcile AniList/Jikan enrichment for offline-imported anime.

    This task repeatedly enqueues metadata, franchise, and theme sync chunks
    for anime imported from Anime Offline Database until all candidates are
    synced (or a hard round cap is hit).
    """

    enable_locking = True
    lock_timeout = 7200

    def _iter_pending_rows(self, *, anime_ids: list[int] | None, batch_size: int):
        queryset = Anime.objects.filter(offline_db_last_seen_at__isnull=False)
        if anime_ids:
            queryset = queryset.filter(id__in=anime_ids)

        return (
            queryset.annotate(
                cast_count=Count("cast", distinct=True),
                staff_count=Count("production_staff", distinct=True),
                theme_count=Count("theme_songs", distinct=True),
            )
            .order_by("-popularity_rank", "id")[:batch_size]
        )

    def _dispatch_chunks(self, ids: list[int], chunk_size: int, dispatch) -> tuple[int, list[str]]:
        jobs = 0
        task_ids: list[str] = []
        if chunk_size <= 0:
            chunk_size = 100

        for idx in range(0, len(ids), chunk_size):
            chunk = ids[idx : idx + chunk_size]
            if not chunk:
                continue
            try:
                result = dispatch(chunk)
                jobs += 1
                task_id = getattr(result, "id", None)
                if task_id:
                    task_ids.append(str(task_id))
            except Exception:
                logger.error(
                    "Failed to enqueue reconciliation sync chunk",
                    exc_info=True,
                    extra={"chunk_size": len(chunk)},
                )

        return jobs, task_ids

    def execute(
        self,
        anime_ids: list[int] | None = None,
        batch_size: int = 500,
        chunk_size: int = 100,
        require_themes: bool = True,
        strict: bool = False,
        max_rounds: int = 24,
        round_number: int = 1,
        round_interval_minutes: int = 15,
    ):
        from .franchises import sync_franchises
        from .metadata import enrich_metadata
        from .themes import sync_theme_songs

        self.metrics.start()
        scoped_ids = anime_ids or None

        metadata_candidates: set[int] = set()
        franchise_candidates: set[int] = set()
        theme_candidates: set[int] = set()
        blocked_without_ids_set: set[int] = set()
        waiting_for_mal_id = 0
        pending = 0
        complete = 0

        for anime in self._iter_pending_rows(anime_ids=scoped_ids, batch_size=batch_size):
            needs_metadata = (
                anime.synopsis == PLACEHOLDER_SYNOPSIS
                or (anime.cast_count or 0) == 0
                or (anime.staff_count or 0) == 0
            )
            needs_themes = bool(require_themes and (anime.theme_count or 0) == 0)

            # If themes are required and MAL ID is missing but AniList ID exists,
            # force metadata refresh to backfill MAL identity from AniList.
            if needs_themes and anime.mal_id is None and anime.anilist_id:
                needs_metadata = True

            if not needs_metadata and not needs_themes:
                complete += 1
                continue

            pending += 1

            has_metadata_identity = bool(anime.anilist_id or anime.mal_id)
            if needs_metadata:
                if has_metadata_identity:
                    metadata_candidates.add(anime.id)
                    if anime.anilist_id:
                        franchise_candidates.add(anime.id)
                else:
                    blocked_without_ids_set.add(anime.id)

            if needs_themes:
                if anime.mal_id:
                    theme_candidates.add(anime.id)
                elif anime.anilist_id:
                    waiting_for_mal_id += 1
                else:
                    blocked_without_ids_set.add(anime.id)

        metadata_jobs, metadata_task_ids = self._dispatch_chunks(
            sorted(metadata_candidates),
            chunk_size,
            lambda chunk: enrich_metadata.delay(
                mode="backfill",
                anime_ids=chunk,
                batch_size=len(chunk),
            ),
        )
        franchise_jobs, franchise_task_ids = self._dispatch_chunks(
            sorted(franchise_candidates),
            chunk_size,
            lambda chunk: sync_franchises.delay(
                mode="backfill",
                anime_ids=chunk,
                batch_size=len(chunk),
                import_missing=True,
            ),
        )
        theme_jobs, theme_task_ids = self._dispatch_chunks(
            sorted(theme_candidates),
            chunk_size,
            lambda chunk: sync_theme_songs.delay(
                anime_ids=chunk,
                limit=len(chunk),
                base_delay=1.0,
            ),
        )

        dispatched_jobs = metadata_jobs + franchise_jobs + theme_jobs
        should_schedule_next = (
            strict
            and round_number < max_rounds
            and (pending > 0 or dispatched_jobs > 0)
            and (metadata_jobs > 0 or theme_jobs > 0)
        )

        next_round_task_id = None
        if should_schedule_next:
            next_result = reconcile_offline_catalog_sync.apply_async(
                kwargs={
                    "anime_ids": anime_ids or [],
                    "batch_size": batch_size,
                    "chunk_size": chunk_size,
                    "require_themes": require_themes,
                    "strict": strict,
                    "max_rounds": max_rounds,
                    "round_number": round_number + 1,
                    "round_interval_minutes": round_interval_minutes,
                },
                countdown=max(60, int(round_interval_minutes) * 60),
            )
            next_round_task_id = getattr(next_result, "id", None)

        self.metrics.record_records(complete)
        return {
            "round_number": round_number,
            "max_rounds": max_rounds,
            "strict": strict,
            "batch_size": batch_size,
            "chunk_size": chunk_size,
            "scoped_anime_count": len(anime_ids or []),
            "pending": pending,
            "complete": complete,
            "blocked_without_ids": len(blocked_without_ids_set),
            "waiting_for_mal_id": waiting_for_mal_id,
            "metadata_candidates": len(metadata_candidates),
            "franchise_candidates": len(franchise_candidates),
            "theme_candidates": len(theme_candidates),
            "metadata_jobs": metadata_jobs,
            "franchise_jobs": franchise_jobs,
            "theme_jobs": theme_jobs,
            "metadata_task_ids": metadata_task_ids,
            "franchise_task_ids": franchise_task_ids,
            "theme_task_ids": theme_task_ids,
            "next_round_scheduled": bool(next_round_task_id),
            "next_round_task_id": next_round_task_id,
            "rounds_exhausted": strict and round_number >= max_rounds,
        }


@shared_task(
    bind=True,
    base=OfflineCatalogImportTask,
    max_retries=2,
    default_retry_delay=300,
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    time_limit=7200,
    soft_time_limit=6900,
)
def import_offline_catalog(
    self,
    release_tag: str = "latest",
    asset_name: str = DEFAULT_ASSET_NAME,
    source_url: str | None = None,
    source_path: str | None = None,
    limit: int | None = None,
    resume: bool = False,
    enqueue_enrichment: bool = False,
    enforce_full_sync: bool = True,
    batch_size: int = 250,
    enrichment_chunk_size: int = 100,
):
    return self.execute(
        release_tag=release_tag,
        asset_name=asset_name,
        source_url=source_url,
        source_path=source_path,
        limit=limit,
        resume=resume,
        enqueue_enrichment=enqueue_enrichment,
        enforce_full_sync=enforce_full_sync,
        batch_size=batch_size,
        enrichment_chunk_size=enrichment_chunk_size,
    )


@shared_task(
    bind=True,
    base=OfflineCatalogReconcileSyncTask,
    max_retries=3,
    default_retry_delay=180,
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    time_limit=3600,
    soft_time_limit=3300,
)
def reconcile_offline_catalog_sync(
    self,
    anime_ids: list[int] | None = None,
    batch_size: int = 500,
    chunk_size: int = 100,
    require_themes: bool = True,
    strict: bool = False,
    max_rounds: int = 24,
    round_number: int = 1,
    round_interval_minutes: int = 15,
):
    return self.execute(
        anime_ids=anime_ids,
        batch_size=batch_size,
        chunk_size=chunk_size,
        require_themes=require_themes,
        strict=strict,
        max_rounds=max_rounds,
        round_number=round_number,
        round_interval_minutes=round_interval_minutes,
    )
