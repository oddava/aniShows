from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.viewsets import GenericViewSet

from apps.core.models import AuditLog, SystemLog
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination
from apps.users.admin_serializers import AuditLogSerializer, SystemLogSerializer


class SystemLogFilter(FilterSet):
    level = CharFilter(field_name='level')
    source = CharFilter(field_name='source')

    class Meta:
        model = SystemLog
        fields = ['level', 'source']


class AuditLogFilter(FilterSet):
    action = CharFilter(field_name='action')
    resource_type = CharFilter(field_name='resource_type')

    class Meta:
        model = AuditLog
        fields = ['action', 'resource_type']


class AdminSystemLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """System error and event logs for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    serializer_class = SystemLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = SystemLogFilter
    search_fields = ['message', 'traceback']
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        return SystemLog.objects.all()


class AdminAuditLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Admin action audit logs."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    search_fields = ['user__username', 'resource_id', 'details']
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        return AuditLog.objects.select_related("user")
