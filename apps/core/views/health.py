from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

from apps.shared.logger import logger


def health_check(request):
    """
    Health check endpoint for Docker and load balancers.

    Checks:
    - Database connectivity
    - Redis cache connectivity
    - Returns 200 if all healthy, 503 if any check fails
    """
    checks = {
        "database": False,
        "cache": False,
    }

    # Check database
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["database"] = True
    except Exception as e:
        logger.error(f"Health check - Database failed: {e}")

    # Check cache
    try:
        cache.set("health_check", "ok", timeout=5)
        if cache.get("health_check") == "ok":
            checks["cache"] = True
    except Exception as e:
        logger.error(f"Health check - Cache failed: {e}")

    # Overall status
    all_healthy = all(checks.values())

    response_data = {
        "status": "healthy" if all_healthy else "unhealthy",
        "checks": checks,
        "version": getattr(settings, "VERSION", "unknown"),
    }

    status_code = 200 if all_healthy else 503

    return JsonResponse(response_data, status=status_code)
