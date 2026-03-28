from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

from apps.core.services.admin_settings_service import is_maintenance_mode_enabled
from apps.shared.logger import logger


def _safe_maintenance_mode() -> bool:
    try:
        return is_maintenance_mode_enabled()
    except Exception as exc:
        logger.error("Health check - Maintenance lookup failed: %s", exc)
        return False


def _base_health_payload(*, maintenance_mode: bool, checks: dict | None = None) -> dict:
    service_available = not maintenance_mode and all((checks or {"app": True}).values())
    if checks and not all(checks.values()):
        status_label = "unhealthy"
    elif maintenance_mode:
        status_label = "maintenance"
    else:
        status_label = "healthy"

    payload = {
        "status": status_label,
        "maintenance_mode": maintenance_mode,
        "service_available": service_available,
        "version": getattr(settings, "VERSION", "unknown"),
    }
    if checks is not None:
        payload["checks"] = checks
    if maintenance_mode:
        payload["detail"] = (
            "Service is temporarily unavailable due to maintenance. Please try again later."
        )
        payload["retry_after"] = 300
    return payload


def health_check(request):
    """Liveness endpoint for load balancers and fast benchmark probes."""
    maintenance_mode = _safe_maintenance_mode()
    return JsonResponse(
        _base_health_payload(maintenance_mode=maintenance_mode, checks={"app": True}),
        status=200,
    )


def readiness_check(request):
    """Readiness endpoint with live dependency checks."""
    checks = {
        "database": False,
        "cache": False,
    }

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["database"] = True
    except Exception as exc:
        logger.error("Readiness check - Database failed: %s", exc)

    try:
        cache.set("health_check", "ok", timeout=5)
        if cache.get("health_check") == "ok":
            checks["cache"] = True
    except Exception as exc:
        logger.error("Readiness check - Cache failed: %s", exc)

    maintenance_mode = _safe_maintenance_mode()
    status_code = 200 if all(checks.values()) else 503
    return JsonResponse(
        _base_health_payload(maintenance_mode=maintenance_mode, checks=checks),
        status=status_code,
    )
