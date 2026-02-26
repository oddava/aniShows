from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from celery import current_app

from apps.core.models import CeleryTaskResult
from apps.core.permissions import IsAdminUser, AdminPagination

IMPORT_TASKS = ["apps.animes.tasks.sync.sync_anime_catalog"]


class AdminImportJobViewSet(viewsets.ViewSet):
    """Import jobs monitoring for admins, mapped to Celery sync tasks."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def _format_task_result(self, result):
        # Determine source and source_type
        source = "System Auto-Sync"
        source_type = "unknown"
        total_items = 0
        processed_items = 0
        error_count = 0
        error_message = result.error_message

        if result.task_name == "apps.animes.tasks.sync.sync_anime_catalog":
            source = "AniList API"
            source_type = result.task_kwargs.get("sync_type", "unknown")

            # Extract items from result_data
            if isinstance(result.result_data, dict):
                processed_items = result.result_data.get("records_processed", 0)
            total_items = (
                result.task_kwargs.get("limit", processed_items)
                if result.task_kwargs
                else processed_items
            )

            error_count = 1 if result.status == "FAILURE" else 0

        # Map statuses from Celery to frontend
        status_map = {
            "PENDING": "pending",
            "STARTED": "processing",
            "RETRY": "processing",
            "SUCCESS": "completed",
            "FAILURE": "failed",
            "REVOKED": "cancelled",
        }
        mapped_status = status_map.get(result.status, "pending")

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
                "task_kwargs": result.task_kwargs,
                "result_summary": result.result_summary,
                "retries": result.retries,
                "worker": result.worker,
            },
        }

    def list(self, request):
        """List all import jobs."""
        queryset = CeleryTaskResult.objects.filter(task_name__in=IMPORT_TASKS).order_by(
            "-date_created"
        )

        # Filters
        status_filter = request.query_params.get("status")
        if status_filter:
            celery_status_map = {
                "pending": ["PENDING"],
                "processing": ["STARTED", "RETRY"],
                "completed": ["SUCCESS"],
                "failed": ["FAILURE"],
                "cancelled": ["REVOKED"],
            }
            if status_filter in celery_status_map:
                queryset = queryset.filter(status__in=celery_status_map[status_filter])

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        jobs_data = [self._format_task_result(job) for job in page]
        return paginator.get_paginated_response(jobs_data)

    def retrieve(self, request, pk=None):
        """Get detailed import job information."""
        try:
            job = CeleryTaskResult.objects.get(pk=pk, task_name__in=IMPORT_TASKS)
        except CeleryTaskResult.DoesNotExist:
            return Response({"detail": "Import job not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(self._format_task_result(job))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending import job."""
        try:
            job = CeleryTaskResult.objects.get(pk=pk, task_name__in=IMPORT_TASKS)
        except CeleryTaskResult.DoesNotExist:
            return Response({"detail": "Import job not found."}, status=status.HTTP_404_NOT_FOUND)

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
        """Trigger a new sync import task."""
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
        except ValueError:
            return Response(
                {"detail": "Limit must be an integer."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            task_path = "apps.animes.tasks.sync.sync_anime_catalog"
            kwargs = {"sync_type": sync_type, "limit": limit}

            result = current_app.send_task(task_path, kwargs=kwargs, queue="default")

            job = CeleryTaskResult.objects.create(
                task_id=result.id,
                task_name=task_path,
                task_module="apps.animes.tasks.sync",
                status="PENDING",
                task_kwargs=kwargs,
                queue="default",
                triggered_by=request.user if request.user.is_authenticated else None,
            )

            return Response(
                {
                    "message": "Import job triggered successfully.",
                    "job_id": job.id,
                    "status": "pending",
                },
                status=status.HTTP_202_ACCEPTED,
            )
        except Exception as e:
            return Response(
                {"detail": f"Failed to trigger task: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
