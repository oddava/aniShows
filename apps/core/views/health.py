from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

from apps.core.services.admin_settings_service import is_maintenance_mode_enabled
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

    maintenance_mode = is_maintenance_mode_enabled()
    service_available = all_healthy and not maintenance_mode

    if not all_healthy:
        status_label = "unhealthy"
    elif maintenance_mode:
        status_label = "maintenance"
    else:
        status_label = "healthy"

    response_data = {
        "status": status_label,
        "checks": checks,
        "maintenance_mode": maintenance_mode,
        "service_available": service_available,
        "version": getattr(settings, "VERSION", "unknown"),
    }

    if maintenance_mode:
        response_data["detail"] = (
            "Service is temporarily unavailable due to maintenance. Please try again later."
        )
        response_data["retry_after"] = 300

    status_code = 200 if all_healthy else 503

    return JsonResponse(response_data, status=status_code)
