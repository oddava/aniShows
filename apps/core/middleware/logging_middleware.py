import time
import logging
from django.conf import settings
from apps.core.models import SystemLog, AuditLog
from apps.core.tasks.logging_tasks import log_request_async

logger = logging.getLogger(__name__)


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

    def __call__(self, request):
        # Skip logging for excluded paths
        if any(request.path.startswith(path) for path in self.excluded_paths):
            return self.get_response(request)

        # Start timing
        start_time = time.time()

        # Get user info before response
        user = (
            request.user
            if hasattr(request, "user") and request.user.is_authenticated
            else None
        )
        user_id = user.id if user else None

        # Process the request
        response = self.get_response(request)

        # Calculate duration
        duration_ms = int((time.time() - start_time) * 1000)

        # Determine log level based on status code
        if response.status_code >= 500:
            level = SystemLog.LogLevel.ERROR
        elif response.status_code >= 400:
            level = SystemLog.LogLevel.WARNING
        else:
            level = SystemLog.LogLevel.INFO

        # Determine log type
        if request.path.startswith("/api/v1/admin/"):
            log_type = SystemLog.LogType.ADMIN
        elif request.path.startswith("/api/v1/auth/"):
            log_type = SystemLog.LogType.AUTH
        else:
            log_type = SystemLog.LogType.REQUEST

        # Get client IP
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        # Fire and forget - log asynchronously via Celery
        try:
            log_data = {
                "level": level,
                "log_type": log_type,
                "user_id": user_id,
                "user_ip": ip,
                "method": request.method,
                "path": request.path[:500],
                "status_code": response.status_code,
                "message": f"{request.method} {request.path} - {response.status_code}",
                "details": {
                    "user_agent": request.META.get("HTTP_USER_AGENT", ""),
                    "query_params": dict(request.GET),
                },
                "duration_ms": duration_ms,
            }
            log_request_async.delay(log_data)
        except Exception as e:
            # Don't let logging errors break the request
            logger.error(f"Failed to queue async log entry: {e}")

        return response


class AdminAuditMiddleware:
    """Middleware to audit admin actions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Store the request method and path before processing
        method = request.method
        path = request.path

        # Only audit admin actions that modify data
        if not path.startswith("/api/v1/admin/"):
            return self.get_response(request)

        if method not in ["POST", "PUT", "PATCH", "DELETE"]:
            return self.get_response(request)

        # Get user info
        user = (
            request.user
            if hasattr(request, "user") and request.user.is_authenticated
            else None
        )
        if not user or not (user.is_staff or user.is_superuser):
            return self.get_response(request)

        # Get client IP
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        # Determine action type
        action_map = {
            "POST": AuditLog.ActionType.CREATE,
            "PUT": AuditLog.ActionType.UPDATE,
            "PATCH": AuditLog.ActionType.UPDATE,
            "DELETE": AuditLog.ActionType.DELETE,
        }
        action = action_map.get(method)

        # Determine entity type from path
        entity_type = self._get_entity_type(path)

        # Process the request
        response = self.get_response(request)

        # Log the audit entry
        if response.status_code < 400:  # Only log successful actions
            try:
                AuditLog.objects.create(
                    user=user,
                    user_ip=ip,
                    action=action,
                    entity_type=entity_type,
                    entity_id=self._extract_entity_id(path),
                    entity_repr=f"{method} {path}",
                    metadata={
                        "status_code": response.status_code,
                        "method": method,
                        "path": path,
                    },
                )
            except Exception as e:
                logger.error(f"Failed to create audit log: {e}")

        return response

    def _get_entity_type(self, path):
        """Extract entity type from API path."""
        parts = path.split("/")
        if len(parts) >= 4:
            entity = parts[3]  # /api/v1/admin/{entity}/
            entity_map = {
                "users": "User",
                "anime": "Anime",
                "genres": "Genre",
                "studios": "Studio",
                "reviews": "Review",
                "user-lists": "UserAnimeList",
                "favorites": "UserFavorite",
                "import-jobs": "ImportJob",
            }
            return entity_map.get(entity, entity.title())
        return "Unknown"

    def _extract_entity_id(self, path):
        """Extract entity ID from path if present."""
        parts = path.rstrip("/").split("/")
        # Check if last part is a number (ID)
        if parts and parts[-1].isdigit():
            return parts[-1]
        return ""


class ExceptionLoggingMiddleware:
    """Middleware to log exceptions."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        """Log unhandled exceptions."""
        user = (
            request.user
            if hasattr(request, "user") and request.user.is_authenticated
            else None
        )

        # Get client IP
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            ip = x_forwarded_for.split(",")[0].strip()
        else:
            ip = request.META.get("REMOTE_ADDR")

        try:
            SystemLog.objects.create(
                level=SystemLog.LogLevel.ERROR,
                log_type=SystemLog.LogType.ERROR,
                user=user,
                user_ip=ip,
                method=request.method,
                path=request.path[:500],
                message=str(exception),
                details={
                    "exception_type": type(exception).__name__,
                    "user_agent": request.META.get("HTTP_USER_AGENT", ""),
                },
            )
        except Exception as e:
            logger.error(f"Failed to log exception: {e}")

        # Return None to let Django handle the exception normally
        return None
