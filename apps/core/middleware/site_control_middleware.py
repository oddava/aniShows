from django.http import JsonResponse

from ..services.admin_settings_service import is_maintenance_mode_enabled


class SiteControlMiddleware:
    """Enforce global site controls such as maintenance mode."""

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
        }

    def __call__(self, request):
        if self._is_exempt_path(request.path):
            return self.get_response(request)

        user = getattr(request, "user", None)
        if user and user.is_authenticated and (user.is_staff or user.is_superuser):
            return self.get_response(request)

        if is_maintenance_mode_enabled():
            response = JsonResponse(
                {
                    "detail": (
                        "Service is temporarily unavailable due to maintenance. "
                        "Please try again later."
                    )
                },
                status=503,
            )
            response["Retry-After"] = "300"
            return response

        return self.get_response(request)

    def _is_exempt_path(self, path: str) -> bool:
        if path in self.exempt_paths:
            return True
        return any(path.startswith(prefix) for prefix in self.exempt_prefixes)
