"""
Health check endpoint for monitoring system status.
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from django.db import connection
from django.core.cache import cache
import logging

logger = logging.getLogger(__name__)


class HealthCheckView(APIView):
    """Health check endpoint that verifies system components."""

    permission_classes = []

    def get(self, request):
        """Check health of all system components."""
        checks = {
            "status": "healthy",
            "database": self._check_database(),
            "cache": self._check_cache(),
        }

        # Determine overall status
        if not all(checks[k]["status"] == "ok" for k in ["database", "cache"]):
            checks["status"] = "degraded"

        return Response(checks)

    def _check_database(self):
        """Check database connectivity."""
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return {"status": "ok", "message": "Database connected"}
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return {"status": "error", "message": str(e)}

    def _check_cache(self):
        """Check Redis cache connectivity."""
        try:
            cache.set("health_check", "ok", 10)
            value = cache.get("health_check")
            if value == "ok":
                return {"status": "ok", "message": "Cache connected"}
            return {"status": "error", "message": "Cache read/write mismatch"}
        except Exception as e:
            logger.error(f"Cache health check failed: {e}")
            return {"status": "error", "message": str(e)}
