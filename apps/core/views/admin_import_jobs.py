from datetime import timedelta

from celery import current_app
from django.db.models import Count, Q
from django.db.utils import OperationalError, ProgrammingError
from django.utils import timezone
from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.animes.models import OfflineAnimeSyncState, OfflineCatalogImport
from apps.core.models import CeleryTaskResult
from apps.core.permissions import IsAdminUser

ANILIST_SYNC_TASK = "apps.animes.tasks.sync.sync_anime_catalog"
OFFLINE_IMPORT_TASK = "apps.animes.tasks.offline_catalog.import_offline_catalog"
OFFLINE_RECONCILE_TASK = "apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync"
IMPORT_TASKS = [ANILIST_SYNC_TASK, OFFLINE_IMPORT_TASK, OFFLINE_RECONCILE_TASK]


class AdminImportJobFilter(FilterSet):
    status = CharFilter(method="filter_status")

    class Meta:
        model = CeleryTaskResult
        fields = ["status"]

    def filter_status(self, queryset, name, value):
        celery_status_map = {
            "pending": ["PENDING"],
            "processing": ["STARTED", "RETRY"],
            "completed": ["SUCCESS"],
            "failed": ["FAILURE"],
            "cancelled": ["REVOKED"],
        }
        status_filter = value.lower()
        if status_filter in celery_status_map:
            return queryset.filter(status__in=celery_status_map[status_filter])
        return queryset


class AdminImportJobViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Import job monitoring for admins."""

    permission_classes = [IsAdminUser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AdminImportJobFilter
    ordering_fields = ["date_created", "date_completed"]
    ordering = ["-date_created"]

    def get_queryset(self):
        return CeleryTaskResult.objects.filter(task_name__in=IMPORT_TASKS)

    def _map_status(self, celery_status: str) -> str:
        status_map = {
            "PENDING": "pending",
            "STARTED": "processing",
            "RETRY": "processing",
            "SUCCESS": "completed",
            "FAILURE": "failed",
            "REVOKED": "cancelled",
        }
        return status_map.get(celery_status, "pending")

    def _coerce_int_or_none(self, value):
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _coerce_bool(self, value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def _find_matching_offline_run(self, result):
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

    def _summarize_task_group(self, *, queued_count: int, task_ids: list[str]):
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
        completion_percent = (
            round((completed / effective_total) * 100)
            if effective_total > 0
            else None
        )

        return {
            "queued": queued,
            "tracked": tracked,
            "completed": completed,
            "successful": successful,
            "failed": failed,
            "running": running,
            "completion_percent": completion_percent,
        }

    def _build_offline_enrichment_progress(self, import_run: OfflineCatalogImport):
        try:
            state_queryset = OfflineAnimeSyncState.objects.filter(
                anime__offline_db_last_seen_at__isnull=False
            )
            total_states = state_queryset.count()

            def _stage_progress(stage_field: str):
                counts = dict(
                    state_queryset.values_list(stage_field).annotate(count=Count("id"))
                )
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
                    "completion_percent": round((synced / total_states) * 100)
                    if total_states > 0
                    else None,
                    "status_counts": counts,
                }

            metadata_progress = _stage_progress("metadata_status")
            franchise_progress = _stage_progress("franchise_status")
            theme_progress = _stage_progress("themes_status")

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
            # Migration not applied yet in this runtime. Keep legacy behavior.
            pass

        # Legacy task-group fallback when no state rows exist yet.
        summary = import_run.summary or {}

        metadata_progress = self._summarize_task_group(
            queued_count=summary.get("metadata_queued", 0),
            task_ids=summary.get("metadata_task_ids", []),
        )
        franchise_progress = self._summarize_task_group(
            queued_count=summary.get("franchises_queued", 0),
            task_ids=summary.get("franchises_task_ids", []),
        )
        theme_progress = self._summarize_task_group(
            queued_count=summary.get("themes_queued", 0),
            task_ids=summary.get("themes_task_ids", []),
        )

        overall_queued = (
            metadata_progress["queued"]
            + franchise_progress["queued"]
            + theme_progress["queued"]
        )
        overall_completed = (
            metadata_progress["completed"]
            + franchise_progress["completed"]
            + theme_progress["completed"]
        )
        overall_running = (
            metadata_progress["running"]
            + franchise_progress["running"]
            + theme_progress["running"]
        )
        overall_percent = (
            round((overall_completed / overall_queued) * 100) if overall_queued > 0 else None
        )

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

    def _format_task_result(self, result):
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
            total_items = (
                task_kwargs.get("limit", processed_items)
                if task_kwargs
                else processed_items
            )
            error_count = 1 if result.status == "FAILURE" else 0

        elif result.task_name == OFFLINE_IMPORT_TASK:
            source = "Anime Offline Database"
            source_type = task_kwargs.get("release_tag", "latest")
            total_items = self._coerce_int_or_none(task_kwargs.get("limit")) or 0

            matching_run = self._find_matching_offline_run(result)
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
                    "enrichment": self._build_offline_enrichment_progress(matching_run),
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
                complete_items = self._coerce_int_or_none(result.result_data.get("complete")) or 0
                pending_items = self._coerce_int_or_none(result.result_data.get("pending")) or 0
                quarantined_items = (
                    self._coerce_int_or_none(result.result_data.get("quarantined_count")) or 0
                )
                processed_items = complete_items + quarantined_items
                total_items = pending_items + processed_items
                blocked = result.result_data.get("blocked_without_ids", 0)
                error_count = blocked if blocked > 0 else (1 if result.status == "FAILURE" else 0)

        mapped_status = self._map_status(result.status)

        return {
            "id": result.id,
            "task_id": result.task_id,
            "source": source,
            "source_type": source_type,
            "status": mapped_status,
            "processed_items": processed_items,
            "total_items": total_items,
            "error_count": error_count,
            "error_message": error_message,
            "created_at": result.date_created.isoformat(),
            "updated_at": result.date_completed.isoformat()
            if result.date_completed
            else result.date_created.isoformat(),
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

    def _create_pending_job(self, *, request, task_path: str, task_module: str, kwargs, queue: str):
        result = current_app.send_task(task_path, kwargs=kwargs, queue=queue)
        return CeleryTaskResult.objects.create(
            task_id=result.id,
            task_name=task_path,
            task_module=task_module,
            status="PENDING",
            task_kwargs=kwargs,
            queue=queue,
            triggered_by=request.user if request.user.is_authenticated else None,
        )

    def _trigger_anilist_import(self, request):
        sync_type = request.data.get("sync_type", "trending")
        limit = request.data.get("limit", 50)

        allowed_sync_types = ["trending", "seasonal", "next_season", "airing", "full_catalog"]
        if sync_type not in allowed_sync_types:
            return Response(
                {"detail": f"Invalid sync_type. Allowed: {allowed_sync_types}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            limit = int(limit)
        except (TypeError, ValueError):
            return Response(
                {"detail": "Limit must be an integer."}, status=status.HTTP_400_BAD_REQUEST
            )

        task_path = ANILIST_SYNC_TASK
        kwargs = {"sync_type": sync_type, "limit": limit}
        job = self._create_pending_job(
            request=request,
            task_path=task_path,
            task_module="apps.animes.tasks.sync",
            kwargs=kwargs,
            queue="default",
        )
        return Response(
            {
                "message": "AniList sync job triggered successfully.",
                "job_id": job.id,
                "status": "pending",
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def _trigger_offline_import(self, request):
        release_tag = request.data.get("release_tag", "latest")
        asset_name = request.data.get("asset_name", "anime-offline-database.jsonl.zst")
        source_url = request.data.get("source_url") or None
        source_path = request.data.get("source_path") or None
        import_limit = request.data.get("import_limit", request.data.get("limit"))
        limit = self._coerce_int_or_none(import_limit)

        batch_size = self._coerce_int_or_none(request.data.get("batch_size")) or 250
        enrichment_chunk_size = (
            self._coerce_int_or_none(request.data.get("enrichment_chunk_size")) or 100
        )
        resume = self._coerce_bool(request.data.get("resume"), default=False)
        enqueue_enrichment = self._coerce_bool(
            request.data.get("enqueue_enrichment"),
            default=True,
        )

        task_path = OFFLINE_IMPORT_TASK
        kwargs = {
            "release_tag": release_tag,
            "asset_name": asset_name,
            "source_url": source_url,
            "source_path": source_path,
            "limit": limit,
            "resume": resume,
            "enqueue_enrichment": enqueue_enrichment,
            "enforce_full_sync": True,
            "batch_size": batch_size,
            "enrichment_chunk_size": enrichment_chunk_size,
        }
        job = self._create_pending_job(
            request=request,
            task_path=task_path,
            task_module="apps.animes.tasks.offline_catalog",
            kwargs=kwargs,
            queue="batch",
        )

        return Response(
            {
                "message": "Offline catalog import job triggered successfully.",
                "job_id": job.id,
                "status": "pending",
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def list(self, request, *args, **kwargs):
        """List all import jobs."""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        jobs_data = [self._format_task_result(job) for job in page]
        return self.get_paginated_response(jobs_data)

    def retrieve(self, request, *args, **kwargs):
        """Get detailed import job information."""
        job = self.get_object()
        return Response(self._format_task_result(job))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending import job."""
        job = self.get_object()

        if job.status not in ["PENDING", "STARTED", "RETRY"]:
            return Response(
                {"detail": f"Cannot cancel job with status: {job.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_app.control.revoke(job.task_id, terminate=True)
        job.status = "REVOKED"
        job.date_completed = timezone.now()
        job.error_message = "Cancelled by admin"
        job.save()

        return Response({"message": "Import job cancelled successfully."})

    @action(detail=False, methods=["post"])
    def trigger(self, request):
        """Trigger a new import job."""
        source = request.data.get("source", "anilist_sync")

        try:
            if source in {"anilist_sync", "anilist"}:
                return self._trigger_anilist_import(request)
            if source in {"offline_catalog", "anime_offline_database"}:
                return self._trigger_offline_import(request)

            return Response(
                {
                    "detail": (
                        "Invalid source. Allowed: anilist_sync, offline_catalog"
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            return Response(
                {"detail": f"Failed to trigger task: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
