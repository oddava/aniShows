from django_filters import CharFilter, DateFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from ...core.models import AuditLog, SystemLog
from ...users.admin_serializers import AuditLogSerializer, SystemLogSerializer
from ..permissions import AdminPolicyMixin
from ..services.logs_service import build_system_log_stats


class SystemLogFilter(FilterSet):
    level = CharFilter(field_name="level")
    log_type = CharFilter(field_name="log_type")
    user = NumberFilter(field_name="user_id")
    start_date = DateFilter(field_name="timestamp", lookup_expr="date__gte")
    end_date = DateFilter(field_name="timestamp", lookup_expr="date__lte")

    class Meta:
        model = SystemLog
        fields = ["level", "log_type", "user", "start_date", "end_date"]


class AuditLogFilter(FilterSet):
    action = CharFilter(field_name="action")
    entity_type = CharFilter(field_name="entity_type")
    entity_id = CharFilter(field_name="entity_id")
    user = NumberFilter(field_name="user_id")

    class Meta:
        model = AuditLog
        fields = ["action", "entity_type", "entity_id", "user"]


class AdminSystemLogViewSet(AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """System error and event logs. Superuser-only: rows hold IPs and user agents."""

    serializer_class = SystemLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = SystemLogFilter
    search_fields = ["message", "path", "method"]
    ordering_fields = ["timestamp", "status_code", "duration_ms"]
    ordering = ["-timestamp"]

    def get_queryset(self):
        return SystemLog.objects.select_related("user")

    @action(detail=False, methods=["get"])
    def stats(self, request):
        queryset = self.filter_queryset(SystemLog.objects.all())
        filtered = any(
            request.query_params.get(name) for name in (*SystemLogFilter.base_filters, "search")
        )
        return Response(build_system_log_stats(queryset, last_24h_only=not filtered))


class AdminAuditLogViewSet(AdminPolicyMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Admin action audit logs (staff read)."""

    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    search_fields = ["user__username", "entity_id", "entity_repr"]
    ordering_fields = ["timestamp"]
    ordering = ["-timestamp"]

    def get_queryset(self):
        return AuditLog.objects.select_related("user")
