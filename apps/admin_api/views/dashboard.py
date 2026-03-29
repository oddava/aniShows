from rest_framework.response import Response
from rest_framework.views import APIView

from apps.admin_api.services.dashboard_service import (
    build_admin_dashboard_payload,
    build_admin_stats_export_payload,
)
from apps.core.permissions import IsAdminUser


class AdminDashboardView(APIView):
    """Dashboard statistics and overview data."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(build_admin_dashboard_payload())


class AdminStatsExportView(APIView):
    """Export statistics data for admins."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(build_admin_stats_export_payload())
