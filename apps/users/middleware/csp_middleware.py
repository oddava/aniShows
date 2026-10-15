"""Content Security Policy for responses served by Django.

The React app's CSP is set by Caddy (Caddyfile.prod); this covers the API,
Django admin and the few server-rendered pages.
"""

from django.conf import settings
from django.utils.deprecation import MiddlewareMixin

# JSON API responses never need to load anything.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

# Django admin: the Jazzmin theme needs inline scripts and eval.
ADMIN_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)

# Other server-rendered pages (profile share previews, allauth). No inline scripts.
PAGE_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)


class CSPMiddleware(MiddlewareMixin):
    def process_response(self, request, response):
        if request.path.startswith("/django-admin/"):
            policy = ADMIN_CSP
        elif response.get("Content-Type", "").startswith("application/json"):
            policy = API_CSP
        else:
            policy = PAGE_CSP

        # Report-only in DEBUG so dev tools (debug toolbar, API docs) keep working.
        header = (
            "Content-Security-Policy-Report-Only" if settings.DEBUG else "Content-Security-Policy"
        )
        response.setdefault(header, policy)
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return response
