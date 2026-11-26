"""Admin Catalog page: the catalog engine's state, its run log, and "run this lane now"."""

from rest_framework import serializers, status
from rest_framework.mixins import ListModelMixin
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from ...animes.catalog.lanes import LANES
from ...animes.catalog.overview import catalog_overview, serialize_run
from ...animes.catalog.runner import LANE_QUEUES, is_running
from ...animes.models import CatalogRun
from ...core.models import AuditLog
from ...shared.errors import ENQUEUE_ERRORS
from ...shared.logger import logger
from ..permissions import AdminPolicyMixin, is_superuser_request
from ..services.audit import record_admin_action


class AdminCatalogView(AdminPolicyMixin, APIView):
    """Coverage, seasons against AniList, every lane's last run, the sweep (staff read)."""

    def get(self, request):
        return Response({**catalog_overview(), "can_run": is_superuser_request(request)})


class CatalogRunSerializer(serializers.BaseSerializer):
    def to_representation(self, instance):
        return serialize_run(instance)


class AdminCatalogRunViewSet(AdminPolicyMixin, ListModelMixin, GenericViewSet):
    """The run log, newest first. ``?lane=`` and ``?status=`` filter; ``?changed=1`` hides quiet runs."""

    serializer_class = CatalogRunSerializer

    def get_queryset(self):
        queryset = CatalogRun.objects.all().order_by("-started_at", "-id")
        lane = self.request.query_params.get("lane")
        if lane in LANES:
            queryset = queryset.filter(lane=lane)
        run_status = self.request.query_params.get("status")
        if run_status in CatalogRun.Status.values:
            queryset = queryset.filter(status=run_status)
        if self.request.query_params.get("changed") in {"1", "true"}:
            queryset = queryset.exclude(
                created=0, updated=0, excluded=0, status=CatalogRun.Status.SUCCEEDED
            )
        return queryset


class AdminCatalogLaneRunView(AdminPolicyMixin, APIView):
    """Queue one lane now (superuser, audited). The sweep can be started over."""

    def post(self, request, lane):
        if lane not in LANES:
            return Response({"detail": "Unknown lane."}, status=status.HTTP_404_NOT_FOUND)
        if is_running(lane):
            return Response(
                {"detail": "This lane is running right now."}, status=status.HTTP_409_CONFLICT
            )
        options = {}
        if lane == "seed" and request.data.get("restart") in {True, "true", "1"}:
            options["restart"] = True

        from ...animes.tasks.catalog import run_catalog_lane

        try:
            result = run_catalog_lane.apply_async(
                kwargs={
                    "lane": lane,
                    "trigger": CatalogRun.Trigger.ADMIN,
                    "user_id": request.user.id,
                    **options,
                },
                queue=LANE_QUEUES.get(lane, "default"),
            )
        except ENQUEUE_ERRORS:
            logger.exception("Queueing a catalog lane failed", extra={"lane": lane})
            return Response(
                {"detail": "Could not reach the task queue."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        record_admin_action(
            request,
            action=AuditLog.ActionType.TRIGGER,
            entity_type="CatalogLane",
            entity_id=lane,
            entity_repr=f"Run catalog lane {lane}" + (" (start over)" if options else ""),
            metadata={"lane": lane, "task_id": result.id, **options},
        )
        return Response(
            {"lane": lane, "task_id": result.id, "message": "Queued."},
            status=status.HTTP_202_ACCEPTED,
        )
