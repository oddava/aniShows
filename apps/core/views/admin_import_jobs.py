from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.core.models import CeleryTaskResult
from apps.core.permissions import IsAdminUser
from apps.core.services.admin_import_jobs_service import (
    IMPORT_TASKS,
    OFFLINE_RECONCILE_TASK,
    cancel_import_job,
    format_task_result,
    trigger_anilist_import,
    trigger_offline_import,
)

__all__ = ["OFFLINE_RECONCILE_TASK", "AdminImportJobFilter", "AdminImportJobViewSet"]


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

    @staticmethod
    def _format_task_result(result):
        """Backward-compatible wrapper kept for existing tests/callers."""
        return format_task_result(result)

    def get_queryset(self):
        return CeleryTaskResult.objects.filter(task_name__in=IMPORT_TASKS)

    def list(self, request, *args, **kwargs):
        """List all import jobs."""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            jobs_data = [format_task_result(job) for job in page]
            return self.get_paginated_response(jobs_data)

        jobs_data = [format_task_result(job) for job in queryset]
        return Response(jobs_data)

    def retrieve(self, request, *args, **kwargs):
        """Get detailed import job information."""
        job = self.get_object()
        return Response(format_task_result(job))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a pending import job."""
        job = self.get_object()
        result = cancel_import_job(job)
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def trigger(self, request):
        """Trigger a new import job."""
        source = request.data.get("source", "anilist_sync")

        try:
            if source in {"anilist_sync", "anilist"}:
                result = trigger_anilist_import(request.data, request.user)
                return Response(result.payload, status=result.status_code)
            if source in {"offline_catalog", "anime_offline_database"}:
                result = trigger_offline_import(request.data, request.user)
                return Response(result.payload, status=result.status_code)

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
