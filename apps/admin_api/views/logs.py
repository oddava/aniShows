from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from django_filters import CharFilter, DateFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

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
        by_level = dict(queryset.values_list("level").annotate(count=Count("id")))
        by_type = dict(queryset.values_list("log_type").annotate(count=Count("id")))

        last_24h = timezone.now() - timedelta(hours=24)
        recent = queryset.filter(timestamp__gte=last_24h)
        recent_total = recent.count()
        recent_errors = recent.filter(level__in=["ERROR", "CRITICAL"]).count()

        return Response(
            {
                "by_level": by_level,
                "by_type": by_type,
                "total": queryset.count(),
                "recent_errors": recent_errors,
                "error_rate": round((recent_errors / recent_total) * 100, 2)
                if recent_total
                else 0.0,
            }
        )


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
