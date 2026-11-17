from django.db.models import Q
from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from ...admin_api.permissions import AdminPolicyMixin
from ...admin_api.services.audit import record_admin_action
from ...shared.logger import logger
from ..models import AuditLog, CeleryTaskResult
from ..services.admin_import_jobs_service import (
    BUSINESS_FAILURE_STATUSES,
    IMPORT_TASKS,
    OFFLINE_RECONCILE_TASK,
    ImportTriggerError,
    cancel_import_job,
    format_task_result,
    trigger_import_job,
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
            "failed": ["FAILURE"],
            "cancelled": ["REVOKED"],
        }
        status_filter = value.lower()
        if status_filter == "completed":
            return queryset.filter(status="SUCCESS").exclude(
                result_data__status__in=BUSINESS_FAILURE_STATUSES
            )
        if status_filter == "failed":
            return queryset.filter(
                Q(status="FAILURE") | Q(result_data__status__in=BUSINESS_FAILURE_STATUSES)
            )
        if status_filter in celery_status_map:
            return queryset.filter(status__in=celery_status_map[status_filter])
        return queryset


class AdminImportJobViewSet(AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Import job monitoring for staff; trigger and cancel are superuser-only."""

    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AdminImportJobFilter
    ordering_fields = ["date_created", "date_completed"]
    ordering = ["-date_created"]

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
        """Cancel a pending or running import job."""
        job = self.get_object()
        try:
            result = cancel_import_job(job)
        except Exception:
            logger.exception("Admin import job cancel failed", extra={"job_id": job.id})
            return Response(
                {"detail": "Failed to cancel the job."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if result.status_code < 400:
            record_admin_action(
                request,
                action=AuditLog.ActionType.CONTROL,
                entity_type="ImportJob",
                entity_id=job.id,
                entity_repr=f"Cancel {job.task_name}"[:200],
                metadata={"task_id": job.task_id, "operation": "cancel"},
            )
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def trigger(self, request):
        """Queue a new import job from one of the four canonical sources."""
        try:
            result = trigger_import_job(request.data, request.user)
        except ImportTriggerError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Admin import job trigger failed")
            return Response(
                {"detail": "Failed to trigger the job."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if result.status_code < 400:
            job = CeleryTaskResult.objects.get(pk=result.payload["job_id"])
            record_admin_action(
                request,
                action=AuditLog.ActionType.TRIGGER,
                entity_type="ImportJob",
                entity_id=job.id,
                entity_repr=f"{request.data.get('source')}: {job.task_name}"[:200],
                metadata={"source": request.data.get("source"), "task_kwargs": job.task_kwargs},
            )
        return Response(result.payload, status=result.status_code)
