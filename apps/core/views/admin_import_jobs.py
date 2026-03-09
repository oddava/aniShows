from celery import current_app
from django.utils import timezone
from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.core.models import CeleryTaskResult
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination

IMPORT_TASKS = ["apps.animes.tasks.sync.sync_anime_catalog"]

class AdminImportJobFilter(FilterSet):
    status = CharFilter(method='filter_status')

    class Meta:
        model = CeleryTaskResult
        fields = ['status']

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
    """Import jobs monitoring for admins, mapped to Celery sync tasks."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AdminImportJobFilter
    ordering_fields = ['date_created', 'date_completed']
    ordering = ['-date_created']

    def get_queryset(self):
        return CeleryTaskResult.objects.filter(task_name__in=IMPORT_TASKS)

    def _format_task_result(self, result):
        source = "System Auto-Sync"
        source_type = "unknown"
        total_items = 0
        processed_items = 0
        error_count = 0
        error_message = result.error_message

        if result.task_name == "apps.animes.tasks.sync.sync_anime_catalog":
            source = "AniList API"
            source_type = result.task_kwargs.get("sync_type", "unknown")

            if isinstance(result.result_data, dict):
                processed_items = result.result_data.get("records_processed", 0)
            total_items = (
                result.task_kwargs.get("limit", processed_items)
                if result.task_kwargs
                else processed_items
            )

            error_count = 1 if result.status == "FAILURE" else 0

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
