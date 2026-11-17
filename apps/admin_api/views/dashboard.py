from contextlib import suppress

from django.core.cache import cache
from rest_framework.response import Response
from rest_framework.views import APIView

from ...shared.errors import CACHE_ERRORS
from ..permissions import AdminPolicyMixin
from ..services.dashboard_service import (
    build_admin_dashboard_payload,
    build_admin_stats_export_payload,
)
from .query_params import wants_refresh

DASHBOARD_CACHE_KEY = "admin:dashboard:v1"
DASHBOARD_CACHE_SECONDS = 60


class AdminDashboardView(AdminPolicyMixin, APIView):
    """Dashboard statistics, cached 60s (``?refresh=1`` rebuilds them)."""

    def get(self, request):
        payload = None
        if not wants_refresh(request):
            try:
                payload = cache.get(DASHBOARD_CACHE_KEY)
            except CACHE_ERRORS:
                payload = None
        if not isinstance(payload, dict):
            payload = build_admin_dashboard_payload()
            with suppress(*CACHE_ERRORS):
                cache.set(DASHBOARD_CACHE_KEY, payload, timeout=DASHBOARD_CACHE_SECONDS)
        return Response(payload)


class AdminStatsExportView(AdminPolicyMixin, APIView):
    """Export statistics data for admins."""

    def get(self, request):
        return Response(build_admin_stats_export_payload())
