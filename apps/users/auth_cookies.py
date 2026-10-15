"""
Refresh-token cookie helpers.

The refresh JWT never reaches JavaScript: it travels in an httpOnly cookie
scoped to ``REFRESH_COOKIE_PATH`` (the refresh endpoint and the logout endpoint
under it). The access token is returned in the response body and kept in
memory by the SPA.

Because the browser attaches the cookie automatically, the endpoints that read
it must be protected against CSRF. SameSite=Lax already keeps it off
cross-site POSTs; on top of that ``cookie_csrf_failure`` demands a custom
header (which cross-origin pages cannot send without a CORS preflight) and,
when the browser sends one, an allowed ``Origin``.
"""

from urllib.parse import urlsplit

from django.conf import settings
from rest_framework_simplejwt.settings import api_settings as jwt_settings

REFRESH_COOKIE_NAME = "anishows_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/refresh/"
CSRF_HEADER = "X-Requested-With"
CSRF_HEADER_VALUE = "XMLHttpRequest"


def _cookie_secure() -> bool:
    return getattr(settings, "JWT_REFRESH_COOKIE_SECURE", True)


def set_refresh_cookie(response, refresh_token: str):
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=int(jwt_settings.REFRESH_TOKEN_LIFETIME.total_seconds()),
        path=REFRESH_COOKIE_PATH,
        secure=_cookie_secure(),
        httponly=True,
        samesite="Lax",
    )
    return response


def clear_refresh_cookie(response):
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH, samesite="Lax")
    return response


def move_refresh_to_cookie(response):
    """Pop ``refresh`` out of a token response body and set it as the cookie."""
    data = getattr(response, "data", None)
    if isinstance(data, dict) and data.get("refresh"):
        set_refresh_cookie(response, data.pop("refresh"))
    return response


def get_refresh_cookie(request) -> str | None:
    return request.COOKIES.get(REFRESH_COOKIE_NAME) or None


def _allowed_origins(request) -> set[str]:
    origins = {f"{request.scheme}://{request.get_host()}"}
    origins.update(getattr(settings, "CSRF_TRUSTED_ORIGINS", []))
    origins.update(getattr(settings, "CORS_ALLOWED_ORIGINS", []))
    if getattr(settings, "FRONTEND_URL", None):
        parts = urlsplit(settings.FRONTEND_URL)
        origins.add(f"{parts.scheme}://{parts.netloc}")
    return {origin.rstrip("/") for origin in origins if origin}


def cookie_csrf_failure(request) -> str | None:
    """Return a reason string when a cookie-authenticated request looks forged."""
    if request.headers.get(CSRF_HEADER) != CSRF_HEADER_VALUE:
        return f"Missing {CSRF_HEADER} header."
    origin = request.headers.get("Origin")
    if origin and origin.rstrip("/") not in _allowed_origins(request):
        return "Origin not allowed."
    return None
