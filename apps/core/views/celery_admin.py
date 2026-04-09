"""
Celery Task Management API Endpoints

Provides REST API for:
- Listing and triggering Celery tasks
- Monitoring task status and results
- Managing scheduled tasks
- Viewing worker status
"""

from django_filters import CharFilter, DateFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response

from ..models import CeleryTaskResult, CeleryTaskSchedule
from ..permissions import IsAdminUser
from ..serializers import (
    CeleryTaskResultDetailSerializer,
    CeleryTaskResultListSerializer,
    CeleryTaskScheduleDetailSerializer,
    CeleryTaskScheduleListSerializer,
    CeleryTaskScheduleWriteSerializer,
)
from ..services.celery_admin_service import (
    AVAILABLE_TASKS,
    build_dashboard_payload,
    build_task_result_stats,
    bulk_delete_task_results,
    control_task,
    get_worker_status_payload,
    perform_worker_control,
    run_schedule_now,
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
    ListModelMixin,
    RetrieveModelMixin,
    DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAdminUser]
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
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete task results."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response({"message": "Task result deleted successfully."})

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete task results."},
                status=status.HTTP_403_FORBIDDEN,
            )

        result = bulk_delete_task_results(
            ids=request.data.get("ids", []),
            days=request.data.get("days"),
        )
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        return Response(build_task_result_stats())


class CeleryTaskScheduleFilter(FilterSet):
    status = CharFilter(field_name="status", lookup_expr="iexact")
    schedule_type = CharFilter(field_name="schedule_type", lookup_expr="iexact")

    class Meta:
        model = CeleryTaskSchedule
        fields = ["status", "schedule_type"]


class CeleryTaskScheduleViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminUser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = CeleryTaskScheduleFilter
    ordering_fields = ["name", "created_at", "last_run_at"]
    ordering = ["name"]

    def get_queryset(self):
        return CeleryTaskSchedule.objects.all()

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return CeleryTaskScheduleWriteSerializer
        if self.action == "list":
            return CeleryTaskScheduleListSerializer
        return CeleryTaskScheduleDetailSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        schedule = serializer.save()
        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "message": "Schedule created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        serializer = self.get_serializer(
            self.get_object(),
            data=request.data,
            partial=kwargs.get("partial", False),
        )
        serializer.is_valid(raise_exception=True)
        schedule = serializer.save()
        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "message": "Schedule updated successfully.",
            }
        )

    def destroy(self, request, *args, **kwargs):
        schedule = self.get_object()
        name = schedule.name
        self.perform_destroy(schedule)
        return Response({"message": f'Schedule "{name}" deleted successfully.'})

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        schedule = self.get_object()
        schedule.status = CeleryTaskSchedule.TaskStatus.ENABLED
        schedule.save(update_fields=["status", "updated_at"])
        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "status": schedule.status,
                "message": "Schedule enabled successfully.",
            }
        )

    @action(detail=True, methods=["post"])
    def disable(self, request, pk=None):
        schedule = self.get_object()
        schedule.status = CeleryTaskSchedule.TaskStatus.DISABLED
        schedule.save(update_fields=["status", "updated_at"])
        return Response(
            {
                "id": schedule.id,
                "name": schedule.name,
                "status": schedule.status,
                "message": "Schedule disabled successfully.",
            }
        )

    @action(detail=True, methods=["post"])
    def run_now(self, request, pk=None):
        schedule = self.get_object()
        try:
            result = run_schedule_now(schedule=schedule, user=request.user)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to trigger task: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(result.payload, status=result.status_code)


class CeleryAdminControlViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser]

    @action(detail=False, methods=["get"])
    def tasks(self, request):
        tasks_list = [
            {
                "task_path": task_path,
                "name": task_info["name"],
                "description": task_info["description"],
                "args_schema": task_info["args_schema"],
                "default_queue": task_info.get("default_queue", "default"),
            }
            for task_path, task_info in AVAILABLE_TASKS.items()
        ]
        return Response({"tasks": tasks_list})

    @action(detail=False, methods=["post"])
    def trigger_task(self, request):
        task_path = request.data.get("task")
        args = request.data.get("args", [])
        kwargs = request.data.get("kwargs", {})
        queue = request.data.get("queue")

        if not task_path:
            return Response(
                {"detail": "Task path is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if task_path not in AVAILABLE_TASKS:
            return Response(
                {"detail": f"Task {task_path} is not allowed or does not exist."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            payload = trigger_task(
                task_path=task_path,
                args=args,
                kwargs=kwargs,
                queue=queue,
                user=request.user,
            )
        except Exception as exc:
            return Response(
                {"detail": f"Failed to trigger task: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(payload, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=["post"])
    def control_task(self, request):
        task_id = request.data.get("task_id")
        task_action = request.data.get("action", "revoke")
        terminate = request.data.get("terminate", False)

        if not task_id:
            return Response(
                {"detail": "Task ID is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = control_task(task_id=task_id, action=task_action, terminate=terminate)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to {task_action} task: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["get"])
    def worker_status(self, request):
        try:
            return Response(get_worker_status_payload())
        except Exception as exc:
            return Response(
                {"detail": f"Failed to get worker status: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=["post"])
    def worker_control(self, request):
        action_name = request.data.get("action")
        worker = request.data.get("worker")

        if not action_name:
            return Response(
                {"detail": "Action is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if action_name == "shutdown" and not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can shutdown workers."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            result = perform_worker_control(action=action_name, worker=worker)
        except Exception as exc:
            return Response(
                {"detail": f"Failed to perform action: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["get"])
    def dashboard(self, request):
        return Response(build_dashboard_payload())
