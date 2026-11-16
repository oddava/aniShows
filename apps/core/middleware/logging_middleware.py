import random
import time
from uuid import UUID

from django.conf import settings
from django.db import DatabaseError

from ...shared.logger import logger
from ..models import AuditLog, SystemLog
from ..tasks.logging_tasks import log_exception_async, log_request_async
from ..utils import get_client_ip

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
ADMIN_API_PREFIX = "/api/v1/admin/"
AUTH_API_PREFIX = "/api/v1/auth/"


def _authenticated_user(request):
    """The request's user once the view has run (DRF sets it for JWT requests)."""
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return user
    return None


class LoggingMiddleware:
    """Queue one ``SystemLog`` row for the requests worth keeping.

    Always logged: mutating admin requests, auth POSTs, 5xx, 403 and 429. Other admin
    requests are never logged. Everything else (401/404 included, which token
    refreshes and bots dominate) is sampled at ``REQUEST_LOG_SUCCESS_SAMPLE_RATE``. Health, metrics, static/media and the logs
    endpoint itself are never logged. The user is read after the view, so JWT
    requests are attributed.
    """

    excluded_prefixes = (
        "/health/",
        "/api/v1/health/",
        "/metrics",
        "/api/v1/admin/logs/",
        "/static/",
        "/media/",
    )
    always_logged_statuses = frozenset({403, 429})

    def __init__(self, get_response):
        self.get_response = get_response
        self.request_logging_enabled = bool(settings.REQUEST_LOGGING_ENABLED)
        raw_sample_rate = settings.REQUEST_LOG_SUCCESS_SAMPLE_RATE
        try:
            sample_rate = float(raw_sample_rate)
        except (TypeError, ValueError):
            sample_rate = 0.05
        self.success_sample_rate = min(max(sample_rate, 0.0), 1.0)
        self.include_query_params = bool(settings.REQUEST_LOG_INCLUDE_QUERY_PARAMS)
        self.include_user_agent = bool(settings.REQUEST_LOG_INCLUDE_USER_AGENT)

    def _is_excluded_path(self, path: str) -> bool:
        return path.startswith(self.excluded_prefixes)

    def _log_level(self, status_code: int) -> str:
        if status_code >= 500:
            return SystemLog.LogLevel.ERROR
        if status_code >= 400:
            return SystemLog.LogLevel.WARNING
        return SystemLog.LogLevel.INFO

    def _log_type(self, path: str) -> str:
        if path.startswith(ADMIN_API_PREFIX):
            return SystemLog.LogType.ADMIN
        if path.startswith(AUTH_API_PREFIX):
            return SystemLog.LogType.AUTH
        return SystemLog.LogType.REQUEST

    def _request_details(self, request) -> dict:
        details = {}
        if self.include_user_agent:
            details["user_agent"] = request.META.get("HTTP_USER_AGENT", "")[:300]
        if self.include_query_params:
            details["query_params"] = dict(request.GET)
        return details

    def _build_log_data(self, request, response, *, user_id: int | None, duration_ms: int) -> dict:
        return {
            "level": self._log_level(response.status_code),
            "log_type": self._log_type(request.path),
            "user_id": user_id,
            "user_ip": get_client_ip(request),
            "method": request.method,
            "path": request.path[:500],
            "status_code": response.status_code,
            "message": f"{request.method} {request.path[:400]} - {response.status_code}",
            "details": self._request_details(request),
            "duration_ms": duration_ms,
        }

    def __call__(self, request):
        if self._is_excluded_path(request.path):
            return self.get_response(request)

        start_time = time.monotonic()
        response = self.get_response(request)
        duration_ms = int((time.monotonic() - start_time) * 1000)

        if not self._should_log_request(request.method, request.path, response.status_code):
            return response

        user = _authenticated_user(request)
        try:
            log_request_async.delay(
                self._build_log_data(
                    request, response, user_id=user.id if user else None, duration_ms=duration_ms
                )
            )
        except Exception:
            logger.exception("Failed to queue async log entry")

        return response

    def _is_always_logged(self, method: str, path: str, status_code: int) -> bool:
        if status_code >= 500 or status_code in self.always_logged_statuses:
            return True
        if method in MUTATING_METHODS and path.startswith(ADMIN_API_PREFIX):
            return True
        return method == "POST" and path.startswith(AUTH_API_PREFIX)

    def _should_log_request(self, method: str, path: str, status_code: int) -> bool:
        if self._is_always_logged(method, path, status_code):
            return True
        if path.startswith(ADMIN_API_PREFIX):
            # Admin reads (an open admin tab polls) are never sampled in.
            return False
        if not self.request_logging_enabled:
            return False
        return random.random() < self.success_sample_rate


class AdminAuditMiddleware:
    """Fallback audit row for a successful admin mutation that the view did not audit.

    Admin views call ``record_admin_action`` with the real entity and diff, which
    flags the request; this then writes nothing. Anything else that mutates under
    ``/api/v1/admin/`` still gets one generic row, so no endpoint goes unaudited.
    The user is read after the view, because DRF authenticates JWT requests there.
    """

    action_map = {
        "POST": AuditLog.ActionType.CREATE,
        "PUT": AuditLog.ActionType.UPDATE,
        "PATCH": AuditLog.ActionType.UPDATE,
        "DELETE": AuditLog.ActionType.DELETE,
    }

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        method = request.method
        path = request.path
        if (
            method not in MUTATING_METHODS
            or not path.startswith(ADMIN_API_PREFIX)
            or response.status_code >= 400
            or getattr(request, "_admin_audited", False)
        ):
            return response

        user = _authenticated_user(request)
        if user is None or not (user.is_staff or user.is_superuser):
            return response

        try:
            AuditLog.objects.create(
                user=user,
                user_ip=get_client_ip(request),
                action=self.action_map[method],
                entity_type=self._get_entity_type(path),
                entity_id=self._extract_entity_id(path),
                entity_repr=f"{method} {path}"[:200],
                metadata={
                    "status_code": response.status_code,
                    "method": method,
                    "path": path[:500],
                    "fallback": True,
                },
            )
        except DatabaseError:
            logger.exception("Failed to write fallback audit log")

        return response

    def _get_entity_type(self, path):
        """Extract entity type from API path."""
        segments = self._admin_segments(path)
        if segments:
            entity = segments[0]
            entity_map = {
                "users": "User",
                "anime": "Anime",
                "genres": "Genre",
                "studios": "Studio",
                "characters": "Character",
                "staff": "Staff",
                "reviews": "Review",
                "review-reports": "ReviewReport",
                "user-lists": "UserAnimeList",
                "favorites": "UserFavorite",
                "import-jobs": "ImportJob",
                "settings": "AdminPanelSettings",
                "logs": "SystemLog",
                "audit-logs": "AuditLog",
                "reports": "Report",
                "bulk": "BulkOperation",
                "dashboard": "Dashboard",
                "celery": "Celery",
            }
            return entity_map.get(entity, entity.replace("-", " ").title().replace(" ", ""))
        return "Unknown"

    def _extract_entity_id(self, path):
        """Extract entity ID from path if present."""
        segments = self._admin_segments(path)
        if len(segments) < 2:
            return ""

        candidate = segments[1]
        action_segments = {
            "reports",
            "stats",
            "export",
            "bulk",
            "dashboard",
            "trigger",
            "control",
            "resolve",
        }
        if candidate in action_segments:
            return ""
        if candidate.isdigit():
            return candidate

        try:
            UUID(candidate)
            return candidate
        except ValueError:
            pass

        if "-" in candidate and len(candidate) >= 8:
            return candidate
        return ""

    def _admin_segments(self, path):
        parts = [part for part in path.split("/") if part]
        if len(parts) >= 4 and parts[:3] == ["api", "v1", "admin"]:
            return parts[3:]
        return []


class ExceptionLoggingMiddleware:
    """Middleware to log exceptions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        """Log unhandled exceptions asynchronously."""
        user = _authenticated_user(request)

        try:
            log_exception_async.delay(
                {
                    "level": SystemLog.LogLevel.ERROR,
                    "log_type": SystemLog.LogType.ERROR,
                    "user_id": user.id if user else None,
                    "user_ip": get_client_ip(request),
                    "method": request.method,
                    "path": request.path[:500],
                    "message": str(exception)[:2000],
                    "details": {
                        "exception_type": type(exception).__name__,
                        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:300],
                    },
                }
            )
        except Exception:
            # Queueing failed: log the request's own exception, with its traceback.
            logger.error(
                "Unhandled exception at %s %s: %s: %s",
                request.method,
                request.path,
                type(exception).__name__,
                exception,
                exc_info=exception,
            )

        return None
