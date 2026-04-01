from dataclasses import dataclass
from datetime import timedelta

from celery import current_app
from django.db.models import Count, Q
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone

from apps.animes.models import OfflineAnimeSyncState, OfflineCatalogImport
from apps.core.models import CeleryTaskResult

ANILIST_SYNC_TASK = "apps.animes.tasks.sync.sync_anime_catalog"
OFFLINE_IMPORT_TASK = "apps.animes.tasks.offline_catalog.import_offline_catalog"
OFFLINE_RECONCILE_TASK = "apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync"
IMPORT_TASKS = [ANILIST_SYNC_TASK, OFFLINE_IMPORT_TASK, OFFLINE_RECONCILE_TASK]
FULL_CATALOG_LIMIT = 5000


@dataclass(slots=True)
class AdminImportJobActionResult:
    payload: dict
    status_code: int


def map_import_job_status(celery_status: str) -> str:
    status_map = {
        "PENDING": "pending",
        "STARTED": "processing",
        "RETRY": "processing",
        "SUCCESS": "completed",
        "FAILURE": "failed",
        "REVOKED": "cancelled",
    }
    return status_map.get(celery_status, "pending")


def coerce_int_or_none(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def find_matching_offline_run(result):
    kwargs = result.task_kwargs or {}
    queryset = OfflineCatalogImport.objects.all()

    release_tag = kwargs.get("release_tag")
    if release_tag:
        queryset = queryset.filter(release_tag=release_tag)

    asset_name = kwargs.get("asset_name")
    if asset_name:
        queryset = queryset.filter(asset_name=asset_name)

    window_start = result.date_created - timedelta(minutes=30)
    run = queryset.filter(created_at__gte=window_start).order_by("-created_at").first()
    if run:
        return run
    return queryset.order_by("-created_at").first()


def summarize_task_group(*, queued_count: int, task_ids: list[str]):
    queued = max(int(queued_count or 0), 0)
    normalized_task_ids = [str(task_id) for task_id in task_ids if task_id]
    if not normalized_task_ids:
        return {
            "queued": queued,
            "tracked": 0,
            "completed": 0,
            "successful": 0,
            "failed": 0,
            "running": 0,
            "completion_percent": 0 if queued else None,
        }

    status_counts = dict(
        CeleryTaskResult.objects.filter(task_id__in=normalized_task_ids)
        .values_list("status")
        .annotate(count=Count("id"))
    )
    tracked = sum(status_counts.values())
    successful = status_counts.get("SUCCESS", 0)
    failed = status_counts.get("FAILURE", 0) + status_counts.get("REVOKED", 0)
    running = (
        status_counts.get("PENDING", 0)
        + status_counts.get("STARTED", 0)
        + status_counts.get("RETRY", 0)
    )
    completed = successful + failed
    effective_total = max(queued, len(normalized_task_ids))
    completion_percent = round((completed / effective_total) * 100) if effective_total > 0 else None

    return {
        "queued": queued,
        "tracked": tracked,
        "completed": completed,
        "successful": successful,
        "failed": failed,
        "running": running,
        "completion_percent": completion_percent,
    }


def build_offline_enrichment_progress(import_run: OfflineCatalogImport):
    try:
        state_queryset = OfflineAnimeSyncState.objects.filter(anime__offline_db_last_seen_at__isnull=False)
        total_states = state_queryset.count()

        def stage_progress(stage_field: str):
            counts = dict(state_queryset.values_list(stage_field).annotate(count=Count("id")))
            synced = counts.get(OfflineAnimeSyncState.StageStatus.SYNCED, 0)
            running = counts.get(OfflineAnimeSyncState.StageStatus.IN_PROGRESS, 0)
            failed = (
                counts.get(OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR, 0)
                + counts.get(OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY, 0)
                + counts.get(OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS, 0)
                + counts.get(OfflineAnimeSyncState.StageStatus.QUARANTINED, 0)
            )
            return {
                "queued": total_states,
                "tracked": total_states,
                "completed": synced,
                "successful": synced,
                "failed": failed,
                "running": running,
                "completion_percent": round((synced / total_states) * 100) if total_states > 0 else None,
                "status_counts": counts,
            }

        metadata_progress = stage_progress("metadata_status")
        franchise_progress = stage_progress("franchise_status")
        theme_progress = stage_progress("themes_status")
        complete_states = state_queryset.filter(
            metadata_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            franchise_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            themes_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            quarantined=False,
        ).count()
        transient_backlog = state_queryset.filter(quarantined=False).filter(
            Q(metadata_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
            | Q(franchise_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
            | Q(themes_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
        ).count()
        quarantined_count = state_queryset.filter(quarantined=True).count()
        top_reasons = list(
            state_queryset.filter(quarantined=True)
            .exclude(quarantine_reason="")
            .values("quarantine_reason")
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )

        if total_states > 0:
            return {
                "metadata": metadata_progress,
                "franchises": franchise_progress,
                "themes": theme_progress,
                "overall": {
                    "queued": total_states,
                    "completed": complete_states,
                    "running": (
                        metadata_progress["running"]
                        + franchise_progress["running"]
                        + theme_progress["running"]
                    ),
                    "completion_percent": round((complete_states / total_states) * 100),
                    "transient_backlog": transient_backlog,
                    "quarantined_count": quarantined_count,
                    "top_quarantine_reasons": top_reasons,
                },
            }
    except (ProgrammingError, OperationalError):
        pass

    summary = import_run.summary or {}
    metadata_progress = summarize_task_group(
        queued_count=summary.get("metadata_queued", 0),
        task_ids=summary.get("metadata_task_ids", []),
    )
    franchise_progress = summarize_task_group(
        queued_count=summary.get("franchises_queued", 0),
        task_ids=summary.get("franchises_task_ids", []),
    )
    theme_progress = summarize_task_group(
        queued_count=summary.get("themes_queued", 0),
        task_ids=summary.get("themes_task_ids", []),
    )

    overall_queued = (
        metadata_progress["queued"] + franchise_progress["queued"] + theme_progress["queued"]
    )
    overall_completed = (
        metadata_progress["completed"]
        + franchise_progress["completed"]
        + theme_progress["completed"]
    )
    overall_running = (
        metadata_progress["running"] + franchise_progress["running"] + theme_progress["running"]
    )
    overall_percent = round((overall_completed / overall_queued) * 100) if overall_queued > 0 else None

    return {
        "metadata": metadata_progress,
        "franchises": franchise_progress,
        "themes": theme_progress,
        "overall": {
            "queued": overall_queued,
            "completed": overall_completed,
            "running": overall_running,
            "completion_percent": overall_percent,
        },
    }


def format_task_result(result):
    task_kwargs = result.task_kwargs or {}
    source = "System Auto-Sync"
    source_type = "unknown"
    total_items = 0
    processed_items = 0
    error_count = 0
    error_message = result.error_message
    extra_metadata = {}

    if result.task_name == ANILIST_SYNC_TASK:
        source = "AniList API"
        source_type = task_kwargs.get("sync_type", "unknown")
        if isinstance(result.result_data, dict):
            processed_items = result.result_data.get("records_processed", 0)
        total_items = task_kwargs.get("limit", processed_items) if task_kwargs else processed_items
        error_count = 1 if result.status == "FAILURE" else 0

    elif result.task_name == OFFLINE_IMPORT_TASK:
        source = "Anime Offline Database"
        source_type = task_kwargs.get("release_tag", "latest")
        total_items = coerce_int_or_none(task_kwargs.get("limit")) or 0
        matching_run = find_matching_offline_run(result)
        if matching_run:
            processed_items = matching_run.records_seen
            if not total_items and matching_run.status == OfflineCatalogImport.Status.COMPLETED:
                total_items = matching_run.records_seen
            error_count = matching_run.records_failed or (1 if result.status == "FAILURE" else 0)
            if matching_run.error_message:
                error_message = matching_run.error_message
            extra_metadata["offline_import"] = {
                "import_run_id": matching_run.id,
                "import_status": matching_run.status,
                "last_processed_line": matching_run.last_processed_line,
                "records_seen": matching_run.records_seen,
                "records_created": matching_run.records_created,
                "records_updated": matching_run.records_updated,
                "records_failed": matching_run.records_failed,
                "records_marked_stale": matching_run.records_marked_stale,
                "summary": matching_run.summary,
                "enrichment": build_offline_enrichment_progress(matching_run),
            }
        else:
            if isinstance(result.result_data, dict):
                processed_items = result.result_data.get("records_seen", 0)
                if not total_items:
                    total_items = result.result_data.get("records_seen", 0)
            error_count = 1 if result.status == "FAILURE" else 0

    elif result.task_name == OFFLINE_RECONCILE_TASK:
        source = "Offline Sync Reconcile"
        source_type = "metadata+themes"
        if isinstance(result.result_data, dict):
            complete_items = coerce_int_or_none(result.result_data.get("complete")) or 0
            pending_items = coerce_int_or_none(result.result_data.get("pending")) or 0
            quarantined_items = coerce_int_or_none(result.result_data.get("quarantined_count")) or 0
            processed_items = complete_items + quarantined_items
            total_items = pending_items + processed_items
            blocked = result.result_data.get("blocked_without_ids", 0)
            error_count = blocked if blocked > 0 else (1 if result.status == "FAILURE" else 0)

    return {
        "id": result.id,
        "task_id": result.task_id,
        "source": source,
        "source_type": source_type,
        "status": map_import_job_status(result.status),
        "processed_items": processed_items,
        "total_items": total_items,
        "error_count": error_count,
        "error_message": error_message,
        "created_at": result.date_created.isoformat(),
        "updated_at": result.date_completed.isoformat() if result.date_completed else result.date_created.isoformat(),
        "duration_seconds": int(result.execution_time) if result.execution_time else None,
        "metadata": {
            "task_args": result.task_args,
            "task_kwargs": task_kwargs,
            "result_summary": result.result_summary,
            "result_data": result.result_data,
            "retries": result.retries,
            "worker": result.worker,
            **extra_metadata,
        },
    }


def create_pending_job(*, user, task_path: str, task_module: str, kwargs, queue: str):
    result = current_app.send_task(task_path, kwargs=kwargs, queue=queue)
    return CeleryTaskResult.objects.create(
        task_id=result.id,
        task_name=task_path,
        task_module=task_module,
        status="PENDING",
        task_kwargs=kwargs,
        queue=queue,
        triggered_by=user if user and user.is_authenticated else None,
    )


def trigger_anilist_import(payload, user) -> AdminImportJobActionResult:
    sync_type = payload.get("sync_type", "trending")
    default_limit = FULL_CATALOG_LIMIT if sync_type == "full_catalog" else 50
    limit = payload.get("limit", default_limit)
    allowed_sync_types = ["trending", "seasonal", "next_season", "airing", "full_catalog"]
    if sync_type not in allowed_sync_types:
        return AdminImportJobActionResult(
            payload={"detail": f"Invalid sync_type. Allowed: {allowed_sync_types}"},
            status_code=400,
        )

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        return AdminImportJobActionResult(
            payload={"detail": "Limit must be an integer."},
            status_code=400,
        )

    job = create_pending_job(
        user=user,
        task_path=ANILIST_SYNC_TASK,
        task_module="apps.animes.tasks.sync",
        kwargs={"sync_type": sync_type, "limit": limit},
        queue="default",
    )
    return AdminImportJobActionResult(
        payload={
            "message": "AniList sync job triggered successfully.",
            "job_id": job.id,
            "status": "pending",
        },
        status_code=202,
    )


def trigger_offline_import(payload, user) -> AdminImportJobActionResult:
    kwargs = {
        "release_tag": payload.get("release_tag", "latest"),
        "asset_name": payload.get("asset_name", "anime-offline-database.jsonl.zst"),
        "source_url": payload.get("source_url") or None,
        "source_path": payload.get("source_path") or None,
        "limit": coerce_int_or_none(payload.get("import_limit", payload.get("limit"))),
        "resume": coerce_bool(payload.get("resume"), default=False),
        "enqueue_enrichment": coerce_bool(payload.get("enqueue_enrichment"), default=True),
        "enforce_full_sync": True,
        "batch_size": coerce_int_or_none(payload.get("batch_size")) or 250,
        "enrichment_chunk_size": coerce_int_or_none(payload.get("enrichment_chunk_size")) or 100,
    }
    job = create_pending_job(
        user=user,
        task_path=OFFLINE_IMPORT_TASK,
        task_module="apps.animes.tasks.offline_catalog",
        kwargs=kwargs,
        queue="batch",
    )
    return AdminImportJobActionResult(
        payload={
            "message": "Offline catalog import job triggered successfully.",
            "job_id": job.id,
            "status": "pending",
        },
        status_code=202,
    )


def cancel_import_job(job) -> AdminImportJobActionResult:
    if job.status not in ["PENDING", "STARTED", "RETRY"]:
        return AdminImportJobActionResult(
            payload={"detail": f"Cannot cancel job with status: {job.status}"},
            status_code=400,
        )

    current_app.control.revoke(job.task_id, terminate=True)
    job.status = "REVOKED"
    job.date_completed = timezone.now()
    job.error_message = "Cancelled by admin"
    job.save()
    return AdminImportJobActionResult(
        payload={"message": "Import job cancelled successfully."},
        status_code=200,
    )
