"""Celery drill-down for superusers: task results, trigger an allowlisted task, revoke.

Queue sizes, workers, beat and recent failures live on the admin System page
(``apps.admin_api.views.system``). Every endpoint here is superuser-only (task
results hold task payloads) and every mutation is audited. Error responses never
echo exception text.
"""

from django.db import transaction
from django_filters import CharFilter, DateFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response

from ...admin_api.permissions import AdminPolicyMixin
from ...admin_api.services.audit import record_admin_action
from ...shared.logger import logger
from ..models import AuditLog, CeleryTaskResult
from ..serializers import CeleryTaskResultDetailSerializer, CeleryTaskResultListSerializer
from ..services.celery_admin_service import (
    AVAILABLE_TASKS,
    CeleryTaskValidationError,
    bulk_delete_task_results,
    control_task,
    trigger_task,
)


class CeleryTaskResultFilter(FilterSet):
    status = CharFilter(field_name="status", lookup_expr="iexact")
    task_name = CharFilter(field_name="task_name", lookup_expr="icontains")
    worker = CharFilter(field_name="worker", lookup_expr="icontains")
    queue = CharFilter(field_name="queue")
    date_from = DateFilter(field_name="date_created", lookup_expr="gte")
    date_to = DateFilter(field_name="date_created", lookup_expr="lte")

    class Meta:
        model = CeleryTaskResult
        fields = ["status", "task_name", "worker", "queue", "date_from", "date_to"]


class CeleryTaskResultViewSet(
    AdminPolicyMixin,
    ListModelMixin,
    RetrieveModelMixin,
    DestroyModelMixin,
    viewsets.GenericViewSet,
):
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = CeleryTaskResultFilter
    search_fields = ["task_id", "task_name", "error_message", "result_summary"]
    ordering_fields = ["date_created", "date_started", "execution_time", "task_name"]
    ordering = ["-date_created"]

    def get_queryset(self):
        return CeleryTaskResult.objects.select_related("triggered_by")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return CeleryTaskResultDetailSerializer
        return CeleryTaskResultListSerializer

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        with transaction.atomic():
            self._audit_and_delete(request, instance)
        return Response({"message": "Task result deleted successfully."})

    def _audit_and_delete(self, request, instance):
        record_admin_action(
            request,
            action=AuditLog.ActionType.DELETE,
            entity_type="CeleryTaskResult",
            entity_id=instance.id,
            entity_repr=instance.task_name,
            metadata={"task_id": instance.task_id, "status": instance.status},
        )
        self.perform_destroy(instance)

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        result = bulk_delete_task_results(
            ids=request.data.get("ids", []),
            days=request.data.get("days"),
        )
        if result.status_code < 400:
            record_admin_action(
                request,
                action=AuditLog.ActionType.BULK_ACTION,
                entity_type="CeleryTaskResult",
                entity_repr=result.payload.get("message", "")[:200],
                metadata={"operation": "bulk_delete", "deleted": result.payload.get("deleted")},
            )
        return Response(result.payload, status=result.status_code)


class CeleryAdminControlViewSet(AdminPolicyMixin, viewsets.ViewSet):
    @action(detail=False, methods=["post"])
    def trigger_task(self, request):
        """Send an allowlisted task with validated kwargs; it goes to its routed queue."""
        task_path = request.data.get("task")
        if not task_path:
            return Response(
                {"detail": "Task path is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        if not isinstance(task_path, str) or task_path not in AVAILABLE_TASKS:
            return Response(
                {"detail": "Task is not allowed or does not exist."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            payload = trigger_task(
                task_path=task_path,
                args=request.data.get("args", []),
                kwargs=request.data.get("kwargs", {}),
                user=request.user,
            )
        except CeleryTaskValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Celery admin trigger failed", extra={"task": task_path})
            return Response(
                {"detail": "Failed to trigger the task."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        record_admin_action(
            request,
            action=AuditLog.ActionType.TRIGGER,
            entity_type="CeleryTask",
            entity_id=payload["task_result_id"],
            entity_repr=task_path,
            metadata={"task_id": payload["task_id"], "kwargs": payload["kwargs"]},
        )
        return Response(payload, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=["post"])
    def control_task(self, request):
        """Revoke a task (optionally terminating it)."""
        task_id = request.data.get("task_id")
        task_action = request.data.get("action", "revoke")
        terminate = request.data.get("terminate", False)

        if not task_id or not isinstance(task_id, str):
            return Response({"detail": "Task ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(terminate, bool):
            return Response(
                {"detail": "terminate must be a boolean."}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            result = control_task(task_id=task_id, action=task_action, terminate=terminate)
        except Exception:
            logger.exception("Celery admin control failed", extra={"task_id": task_id})
            return Response(
                {"detail": "Failed to control the task."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if result.status_code < 400:
            record_admin_action(
                request,
                action=AuditLog.ActionType.CONTROL,
                entity_type="CeleryTask",
                entity_id=task_id[:50],
                entity_repr=f"{task_action} {task_id}",
                metadata={"operation": task_action, "terminate": terminate},
            )
        return Response(result.payload, status=result.status_code)
