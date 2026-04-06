import random
import time
from uuid import UUID

from django.conf import settings

from apps.core.models import AuditLog, SystemLog
from apps.core.tasks.logging_tasks import log_audit_async, log_exception_async, log_request_async
from apps.core.utils import get_client_ip
from apps.shared.logger import logger


class LoggingMiddleware:
    """Middleware to log all requests and responses asynchronously."""

    def __init__(self, get_response):
        self.get_response = get_response
        # Paths to exclude from logging
        self.excluded_paths = [
            "/health/",
            "/static/",
            "/media/",
            "/admin/logs/",
        ]
        self.always_log_prefixes = [
            "/api/v1/admin/",
            "/api/v1/auth/",
        ]
        self.request_logging_enabled = bool(getattr(settings, "REQUEST_LOGGING_ENABLED", True))
        raw_sample_rate = getattr(settings, "REQUEST_LOG_SUCCESS_SAMPLE_RATE", 0.05)
        try:
            sample_rate = float(raw_sample_rate)
        except (TypeError, ValueError):
            sample_rate = 0.05
        self.success_sample_rate = min(max(sample_rate, 0.0), 1.0)
        self.include_query_params = bool(getattr(settings, "REQUEST_LOG_INCLUDE_QUERY_PARAMS", False))
        self.include_user_agent = bool(getattr(settings, "REQUEST_LOG_INCLUDE_USER_AGENT", True))

    def _is_excluded_path(self, path: str) -> bool:
        return any(path.startswith(excluded_path) for excluded_path in self.excluded_paths)

    def _request_user(self, request):
        if hasattr(request, "user") and request.user.is_authenticated:
            return request.user
        return None

    def _log_level(self, status_code: int) -> str:
        if status_code >= 500:
            return SystemLog.LogLevel.ERROR
        if status_code >= 400:
            return SystemLog.LogLevel.WARNING
        return SystemLog.LogLevel.INFO

    def _log_type(self, path: str) -> str:
        if path.startswith("/api/v1/admin/"):
            return SystemLog.LogType.ADMIN
        if path.startswith("/api/v1/auth/"):
            return SystemLog.LogType.AUTH
        return SystemLog.LogType.REQUEST

    def _request_details(self, request) -> dict:
        details = {}
        if self.include_user_agent:
            details["user_agent"] = request.META.get("HTTP_USER_AGENT", "")
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
            "message": f"{request.method} {request.path} - {response.status_code}",
            "details": self._request_details(request),
            "duration_ms": duration_ms,
        }

    def __call__(self, request):
        if self._is_excluded_path(request.path):
            return self.get_response(request)

        start_time = time.time()
        user = self._request_user(request)
        user_id = user.id if user else None
        response = self.get_response(request)
        duration_ms = int((time.time() - start_time) * 1000)

        if not self._should_log_request(request.path, response.status_code):
            return response

        try:
            log_request_async.delay(
                self._build_log_data(request, response, user_id=user_id, duration_ms=duration_ms)
            )
        except Exception as exc:
            logger.error("Failed to queue async log entry: %s", exc)

        return response

    def _should_log_request(self, path: str, status_code: int) -> bool:
        if status_code >= 400:
            return True

        if any(path.startswith(prefix) for prefix in self.always_log_prefixes):
            return True

        if not self.request_logging_enabled:
            return False

        return random.random() < self.success_sample_rate


class AdminAuditMiddleware:
    """Middleware to audit admin actions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        method = request.method
        path = request.path

        if not path.startswith("/api/v1/admin/"):
            return self.get_response(request)

        if method not in ["POST", "PUT", "PATCH", "DELETE"]:
            return self.get_response(request)

        user = request.user if hasattr(request, "user") and request.user.is_authenticated else None
        if not user or not (user.is_staff or user.is_superuser):
            return self.get_response(request)

        action_map = {
            "POST": AuditLog.ActionType.CREATE,
            "PUT": AuditLog.ActionType.UPDATE,
            "PATCH": AuditLog.ActionType.UPDATE,
            "DELETE": AuditLog.ActionType.DELETE,
        }
        action = action_map.get(method)
        response = self.get_response(request)

        if response.status_code < 400:  # Only log successful actions
            try:
                log_audit_async.delay(
                    {
                        "user_id": user.id,
                        "user_ip": get_client_ip(request),
                        "action": action,
                        "entity_type": self._get_entity_type(path),
                        "entity_id": self._extract_entity_id(path),
                        "entity_repr": f"{method} {path}",
                        "metadata": {
                            "status_code": response.status_code,
                            "method": method,
                            "path": path,
                        },
                    }
                )
            except Exception as exc:
                logger.error("Failed to queue audit log: %s", exc)

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
        user = request.user if hasattr(request, "user") and request.user.is_authenticated else None

        try:
            log_exception_async.delay(
                {
                    "level": SystemLog.LogLevel.ERROR,
                    "log_type": SystemLog.LogType.ERROR,
                    "user_id": user.id if user else None,
                    "user_ip": get_client_ip(request),
                    "method": request.method,
                    "path": request.path[:500],
                    "message": str(exception),
                    "details": {
                        "exception_type": type(exception).__name__,
                        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
                    },
                }
            )
        except Exception:
            logger.error(
                f"Unhandled exception at {request.method} {request.path}: "
                f"{type(exception).__name__}: {exception}"
            )

        return None
