from django.http import JsonResponse
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

from ...users.authentication import RevocableJWTAuthentication
from ..services.admin_settings_service import is_maintenance_mode_enabled

MAINTENANCE_RETRY_AFTER_SECONDS = "300"


def _is_staff(user) -> bool:
    return bool(
        user is not None
        and user.is_authenticated
        and user.is_active
        and (user.is_staff or user.is_superuser)
    )


class SiteControlMiddleware:
    """Enforce global site controls such as maintenance mode.

    During maintenance, staff keep access whether they sign in with a session or a
    JWT. A JWT is only decoded when maintenance is on and the session user is not
    staff, so normal traffic pays nothing for it. Everyone else gets a 503.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.exempt_prefixes = (
            "/health/",
            "/api/v1/health/",
            "/metrics",
            "/static/",
            "/media/",
            "/api/v1/admin/",
            "/django-admin/",
            "/accounts/",
        )
        self.exempt_paths = {
            "/api/v1/auth/login/",
            "/api/v1/auth/refresh/",
            "/api/v1/auth/password-reset/",
            "/api/v1/auth/password-reset-confirm/",
            "/api/v1/auth/resend-verification/",
            "/api/v1/users/me/",
            "/api/v1/announcements/active/",
        }

    def __call__(self, request):
        if self._is_exempt_path(request.path) or not is_maintenance_mode_enabled():
            return self.get_response(request)

        if _is_staff(getattr(request, "user", None)) or self._is_jwt_staff(request):
            return self.get_response(request)

        response = JsonResponse(
            {
                "detail": (
                    "Service is temporarily unavailable due to maintenance. Please try again later."
                )
            },
            status=503,
        )
        response["Retry-After"] = MAINTENANCE_RETRY_AFTER_SECONDS
        return response

    def _is_jwt_staff(self, request) -> bool:
        """Whether a valid Bearer token belongs to an active staff account."""
        try:
            result = RevocableJWTAuthentication().authenticate(request)
        except (AuthenticationFailed, InvalidToken, TokenError):
            return False
        if result is None:
            return False
        user, _token = result
        return _is_staff(user)

    def _is_exempt_path(self, path: str) -> bool:
        if path in self.exempt_paths:
            return True
        return any(path.startswith(prefix) for prefix in self.exempt_prefixes)
