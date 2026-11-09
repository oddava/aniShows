import uuid

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q

from ...shared.celery import observed_shared_task
from ...shared.logger import logger
from ..models import Anime, OfflineAnimeSyncState
from ..services.catalog_sync import CatalogSyncService
from ..services.metadata_health import build_stalled_offline_metadata_query
from ..services.offline_catalog import (
    DEFAULT_ASSET_NAME,
    OfflineCatalogImportService,
)
from ..services.offline_sync import OfflineSyncService
from .base import BaseTask
from .watch_episodes import sync_watch_episodes_batch


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
        try:
            result = service.run_import(
                release_tag=release_tag,
                asset_name=asset_name,
                source_url=source_url,
                source_path=source_path,
                limit=limit,
                resume=resume,
                enqueue_enrichment=enqueue_enrichment,
            )
        except SoftTimeLimitExceeded:
            # Restarting the import now would just be killed by the hard limit.
            raise
        except Exception:
            if source_path or limit or resume:
                raise
            logger.warning("Offline catalog import interrupted; retrying once with resume")
            result = service.run_import(
                release_tag=release_tag,
                asset_name=asset_name,
                source_url=source_url,
                source_path=source_path,
                limit=limit,
                resume=True,
                enqueue_enrichment=enqueue_enrichment,
            )
        rank_limit = max(int(getattr(settings, "OFFLINE_IMPORT_TRENDING_RANK_LIMIT", 50)), 1)
        catalog_sync = CatalogSyncService()
        ranked_ids = catalog_sync.get_trending_anime_ids(limit=rank_limit)
        result["trending_ranks_refreshed"] = (
            catalog_sync.refresh_trending_ranks(ranked_ids) if ranked_ids else 0
        )

        watch_episode_task_id = None
        changed_ids = result.get("changed_anime_ids") or []
        if changed_ids and getattr(settings, "ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED", True):
            watch_result = sync_watch_episodes_batch.apply_async(
                kwargs={"anime_ids": changed_ids, "force": True}
            )
            watch_episode_task_id = getattr(watch_result, "id", None)

        if enforce_full_sync and enqueue_enrichment:
            reconcile_offline_catalog_sync.delay(
                anime_ids=[],
                strict=False,
                max_rounds=settings.OFFLINE_RECONCILE_MAX_ROUNDS,
                round_number=1,
                round_interval_minutes=settings.OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES,
                batch_size=settings.OFFLINE_RECONCILE_BATCH_SIZE,
                chunk_size=enrichment_chunk_size,
                require_themes=True,
            )
        result["watch_episode_sync_queued"] = bool(watch_episode_task_id)
        result["watch_episode_sync_task_id"] = watch_episode_task_id
        result["changed_anime_count"] = len(changed_ids)
        if len(changed_ids) > 100:
            result["changed_anime_ids_sample"] = changed_ids[:100]
            result["changed_anime_ids"] = changed_ids[:100]
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
    workflow_lock_key = "offline-sync:reconcile:global-workflow"

    def execute(
        self,
        anime_ids: list[int] | None = None,
        batch_size: int | None = None,
        chunk_size: int | None = None,
        require_themes: bool = True,
        strict: bool = False,
        reset_pipeline: bool = False,
        max_rounds: int | None = None,
        round_number: int = 1,
        round_interval_minutes: int | None = None,
        workflow_key: str | None = None,
    ):
        self.metrics.start()
        batch_size = max(1, int(batch_size or settings.OFFLINE_RECONCILE_BATCH_SIZE))
        chunk_size = max(1, int(chunk_size or settings.OFFLINE_RECONCILE_CHUNK_SIZE))
        max_rounds = max(1, int(max_rounds or settings.OFFLINE_RECONCILE_MAX_ROUNDS))
        round_interval_minutes = max(
            1,
            int(round_interval_minutes or settings.OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES),
        )
        global_scope = not bool(anime_ids)
        workflow_key = self._resolve_workflow_key(global_scope, workflow_key)
        if global_scope and not self._acquire_workflow_lease(workflow_key):
            return self._skipped_overlap_result(
                max_rounds=max_rounds,
                strict=strict,
                batch_size=batch_size,
                chunk_size=chunk_size,
                round_number=round_number,
                workflow_key=workflow_key,
            )

        scoped_ids = self._resolve_scope_ids(anime_ids)
        should_schedule_next = False
        next_round_task_id = None

        try:
            if scoped_ids == []:
                return {
                    "round_number": round_number,
                    "max_rounds": max_rounds,
                    "strict": strict,
                    "batch_size": batch_size,
                    "chunk_size": chunk_size,
                    "scoped_anime_count": 0,
                    "reset_pipeline": reset_pipeline,
                    "pending": 0,
                    "complete": 0,
                    "processed": 0,
                    "claimed": 0,
                    "blocked_without_ids": 0,
                    "waiting_for_mal_id": 0,
                    "metadata_candidates": 0,
                    "franchise_candidates": 0,
                    "theme_candidates": 0,
                    "metadata_jobs": 0,
                    "franchise_jobs": 0,
                    "theme_jobs": 0,
                    "metadata_task_ids": [],
                    "franchise_task_ids": [],
                    "theme_task_ids": [],
                    "stage_counts": {},
                    "reason_counts": {},
                    "transient_backlog": 0,
                    "quarantined_count": 0,
                    "top_quarantine_reasons": [],
                    "next_round_scheduled": False,
                    "next_round_task_id": None,
                    "rounds_exhausted": False,
                    "skipped_due_to_overlap": False,
                    "workflow_key": workflow_key,
                }
            service = OfflineSyncService()
            if scoped_ids:
                service.ensure_states_for_anime_ids(scoped_ids, reset_pipeline=reset_pipeline)

            reconcile_result = service.reconcile_due(
                batch_size=max(1, int(batch_size)),
                anime_ids=scoped_ids,
            )

            stage_counts = reconcile_result.get("stage_counts", {})
            reason_counts = reconcile_result.get("reason_counts", {})
            metadata_counts = stage_counts.get("metadata", {})
            franchise_counts = stage_counts.get("franchise", {})
            themes_counts = stage_counts.get("themes", {})
            pending = reconcile_result.get("pending", 0)
            complete = reconcile_result.get("complete", 0)
            blocked_without_ids = sum(
                reason_counts.get(code, 0)
                for code in ("missing_ids", "invalid_ids", "invalid_variable", "not_found")
            )
            dispatched_jobs = reconcile_result.get("processed", 0)
            backlog_remaining = pending > 0 or dispatched_jobs > 0
            should_schedule_next = round_number < max_rounds and backlog_remaining

            if should_schedule_next:
                next_result = reconcile_offline_catalog_sync.apply_async(
                    kwargs={
                        "anime_ids": anime_ids or [],
                        "batch_size": batch_size,
                        "chunk_size": chunk_size,
                        "require_themes": require_themes,
                        "strict": strict,
                        "reset_pipeline": False,
                        "max_rounds": max_rounds,
                        "round_number": round_number + 1,
                        "round_interval_minutes": round_interval_minutes,
                        "workflow_key": workflow_key,
                    },
                    countdown=max(60, int(round_interval_minutes) * 60),
                )
                next_round_task_id = getattr(next_result, "id", None)

            self.metrics.record_records(reconcile_result.get("processed", 0))
            return {
                "round_number": round_number,
                "max_rounds": max_rounds,
                "strict": strict,
                "batch_size": batch_size,
                "chunk_size": chunk_size,
                "scoped_anime_count": len(scoped_ids or []),
                "reset_pipeline": reset_pipeline,
                "pending": pending,
                "complete": complete,
                "processed": reconcile_result.get("processed", 0),
                "claimed": reconcile_result.get("claimed", 0),
                "blocked_without_ids": blocked_without_ids,
                "waiting_for_mal_id": 0,
                "metadata_candidates": metadata_counts.get("synced", 0)
                + metadata_counts.get("transient_error", 0)
                + metadata_counts.get("blocked_identity", 0)
                + metadata_counts.get("blocked_no_ids", 0)
                + metadata_counts.get("quarantined", 0),
                "franchise_candidates": franchise_counts.get("synced", 0)
                + franchise_counts.get("transient_error", 0)
                + franchise_counts.get("blocked_identity", 0)
                + franchise_counts.get("blocked_no_ids", 0)
                + franchise_counts.get("quarantined", 0),
                "theme_candidates": themes_counts.get("synced", 0)
                + themes_counts.get("transient_error", 0)
                + themes_counts.get("blocked_identity", 0)
                + themes_counts.get("blocked_no_ids", 0)
                + themes_counts.get("quarantined", 0),
                "metadata_jobs": 0,
                "franchise_jobs": 0,
                "theme_jobs": 0,
                "metadata_task_ids": [],
                "franchise_task_ids": [],
                "theme_task_ids": [],
                "stage_counts": stage_counts,
                "reason_counts": reason_counts,
                "transient_backlog": reconcile_result.get("transient_backlog", 0),
                "quarantined_count": reconcile_result.get("quarantined_count", 0),
                "top_quarantine_reasons": reconcile_result.get("top_quarantine_reasons", []),
                "next_round_scheduled": bool(next_round_task_id),
                "next_round_task_id": next_round_task_id,
                "rounds_exhausted": round_number >= max_rounds and backlog_remaining,
                "skipped_due_to_overlap": False,
                "workflow_key": workflow_key,
            }
        finally:
            if global_scope and workflow_key:
                if should_schedule_next:
                    self._refresh_workflow_lease(workflow_key)
                else:
                    self._release_workflow_lease(workflow_key)

    def _resolve_scope_ids(self, anime_ids: list[int] | None) -> list[int] | None:
        scoped_ids = sorted({int(anime_id) for anime_id in (anime_ids or []) if anime_id})
        if scoped_ids:
            return scoped_ids

        return list(
            Anime.objects.filter(offline_db_last_seen_at__isnull=False)
            .filter(
                Q(offline_sync_state__isnull=True)
                | (
                    Q(offline_sync_state__quarantined=False)
                    & (
                        ~Q(
                            offline_sync_state__metadata_status=OfflineAnimeSyncState.StageStatus.SYNCED,
                            offline_sync_state__franchise_status=OfflineAnimeSyncState.StageStatus.SYNCED,
                            offline_sync_state__themes_status=OfflineAnimeSyncState.StageStatus.SYNCED,
                        )
                        | build_stalled_offline_metadata_query()
                    )
                )
            )
            .distinct()
            .values_list("id", flat=True)
        )

    def _resolve_workflow_key(self, global_scope: bool, workflow_key: str | None) -> str | None:
        if not global_scope:
            return None
        # Follow-up rounds forward this key, so a fresh UUID is sufficient for
        # the first invocation and avoids touching Celery's lazy request object.
        return workflow_key or uuid.uuid4().hex

    def _workflow_lock_timeout(self) -> int:
        return max(getattr(settings, "OFFLINE_RECONCILE_WORKFLOW_LOCK_SECONDS", 7200), 60)

    def _acquire_workflow_lease(self, workflow_key: str | None) -> bool:
        existing = cache.get(self.workflow_lock_key)
        if existing and existing != workflow_key:
            return False
        cache.set(self.workflow_lock_key, workflow_key, timeout=self._workflow_lock_timeout())
        return True

    def _refresh_workflow_lease(self, workflow_key: str | None) -> None:
        cache.set(self.workflow_lock_key, workflow_key, timeout=self._workflow_lock_timeout())

    def _release_workflow_lease(self, workflow_key: str | None) -> None:
        if cache.get(self.workflow_lock_key) == workflow_key:
            cache.delete(self.workflow_lock_key)

    def _skipped_overlap_result(
        self,
        *,
        max_rounds: int,
        strict: bool,
        batch_size: int,
        chunk_size: int,
        round_number: int,
        workflow_key: str | None,
    ) -> dict:
        return {
            "round_number": round_number,
            "max_rounds": max_rounds,
            "strict": strict,
            "batch_size": batch_size,
            "chunk_size": chunk_size,
            "scoped_anime_count": 0,
            "reset_pipeline": False,
            "pending": 0,
            "complete": 0,
            "processed": 0,
            "claimed": 0,
            "blocked_without_ids": 0,
            "waiting_for_mal_id": 0,
            "metadata_candidates": 0,
            "franchise_candidates": 0,
            "theme_candidates": 0,
            "metadata_jobs": 0,
            "franchise_jobs": 0,
            "theme_jobs": 0,
            "metadata_task_ids": [],
            "franchise_task_ids": [],
            "theme_task_ids": [],
            "stage_counts": {},
            "reason_counts": {},
            "transient_backlog": 0,
            "quarantined_count": 0,
            "top_quarantine_reasons": [],
            "next_round_scheduled": False,
            "next_round_task_id": None,
            "rounds_exhausted": False,
            "skipped_due_to_overlap": True,
            "workflow_key": workflow_key,
        }


@observed_shared_task(
    base=OfflineCatalogImportTask,
    retry_policy="long",
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


@observed_shared_task(
    base=OfflineCatalogReconcileSyncTask,
    retry_policy="long",
    time_limit=3600,
    soft_time_limit=3300,
)
def reconcile_offline_catalog_sync(
    self,
    anime_ids: list[int] | None = None,
    batch_size: int | None = None,
    chunk_size: int | None = None,
    require_themes: bool = True,
    strict: bool = False,
    reset_pipeline: bool = False,
    max_rounds: int | None = None,
    round_number: int = 1,
    round_interval_minutes: int | None = None,
    workflow_key: str | None = None,
):
    return self.execute(
        anime_ids=anime_ids,
        batch_size=batch_size,
        chunk_size=chunk_size,
        require_themes=require_themes,
        strict=strict,
        reset_pipeline=reset_pipeline,
        max_rounds=max_rounds,
        round_number=round_number,
        round_interval_minutes=round_interval_minutes,
        workflow_key=workflow_key,
    )
