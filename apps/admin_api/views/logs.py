from django_filters import CharFilter, DateFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.admin_api.services.logs_service import build_system_log_stats
from apps.core.models import AuditLog, SystemLog
from apps.core.permissions import IsAdminUser
from apps.users.admin_serializers import AuditLogSerializer, SystemLogSerializer


class SystemLogFilter(FilterSet):
    level = CharFilter(field_name='level')
    log_type = CharFilter(field_name='log_type')
    user = NumberFilter(field_name='user_id')
    start_date = DateFilter(field_name='timestamp', lookup_expr='date__gte')
    end_date = DateFilter(field_name='timestamp', lookup_expr='date__lte')

    class Meta:
        model = SystemLog
        fields = ['level', 'log_type', 'user', 'start_date', 'end_date']


class AuditLogFilter(FilterSet):
    action = CharFilter(field_name='action')
    entity_type = CharFilter(field_name='entity_type')

    class Meta:
        model = AuditLog
        fields = ['action', 'entity_type']


class AdminSystemLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """System error and event logs for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = SystemLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = SystemLogFilter
    search_fields = ['message', 'path', 'method']
    ordering_fields = ['timestamp', 'status_code', 'duration_ms']
    ordering = ['-timestamp']

    def get_queryset(self):
        queryset = SystemLog.objects.all()
        return queryset

    @action(detail=False, methods=["get"])
    def stats(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        return Response(build_system_log_stats(queryset))


class AdminAuditLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Admin action audit logs."""

    permission_classes = [IsAdminUser]
    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    search_fields = ['user__username', 'entity_id', 'entity_repr']
    ordering_fields = ['timestamp']
    ordering = ['-timestamp']

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("user")
        return queryset
