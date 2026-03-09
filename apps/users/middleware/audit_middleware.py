"""Audit logging middleware for security-relevant actions."""

import logging
import time

from django.utils.deprecation import MiddlewareMixin

from apps.core.utils import get_client_ip

audit_logger = logging.getLogger("api.audit")

class AuditMiddleware(MiddlewareMixin):
    """
    Log security-relevant actions.

    Add to settings.py MIDDLEWARE:
    'api.middleware.audit_middleware.AuditMiddleware',
    """

    SENSITIVE_ENDPOINTS = {
        "/api/v1/auth/login/",
        "/api/v1/auth/register/",
        "/api/v1/auth/password-reset/",
        "/api/v1/auth/change-password/",
        "/api/v1/auth/delete-account/",
        "/api/v1/auth/change-email/",
        "/api/v1/import/",
        "/api/v1/export/",
    }

    def process_request(self, request):
        request._audit_start_time = time.time()
        return None

    def process_response(self, request, response):
        # Only log sensitive endpoints
        if not any(request.path.endswith(endpoint) for endpoint in self.SENSITIVE_ENDPOINTS):
            return response

        duration = time.time() - getattr(request, "_audit_start_time", time.time())

        audit_logger.info(
            "API Audit",
            extra={
                "event": "api_access",
                "path": request.path,
                "method": request.method,
                "user_id": request.user.id if request.user.is_authenticated else None,
                "ip": get_client_ip(request),
                "status_code": response.status_code,
                "duration_ms": int(duration * 1000),
                "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            },
        )

        return response
