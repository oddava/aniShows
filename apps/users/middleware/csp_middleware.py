"""Content Security Policy middleware."""

from django.utils.deprecation import MiddlewareMixin


class CSPMiddleware(MiddlewareMixin):
    """
    Add Content Security Policy headers.

    Add to settings.py MIDDLEWARE (before SecurityMiddleware):
    'api.middleware.csp_middleware.CSPMiddleware',
    """

    def process_response(self, request, response):
        # Always add CSP headers for security
        from django.conf import settings

        is_admin = request.path.startswith("/django-admin/")

        # Base CSP directives - stricter without unsafe-inline
        csp_directives = {
            "default-src": ["'self'"],
            "script-src": [
                "'self'",
                "'unsafe-inline'",  # Note: Consider removing after refactoring inline scripts
                "'unsafe-eval'",  # Required by Jazzmin admin theme
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
            ],
            "style-src": [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com",
            ],
            "font-src": [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
            ],
            "img-src": ["'self'", "data:", "https:", "http:", "blob:"],
            "connect-src": [
                "'self'",
                "https://www.google-analytics.com",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
            ],
            "media-src": ["'self'", "https:", "http:"],
            "frame-src": ["'self'", "https://www.youtube.com", "https://youtube.com"],
            "frame-ancestors": ["'none'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
        }

        # Build CSP header
        csp_header = "; ".join(
            f"{key} {' '.join(values)}" for key, values in csp_directives.items()
        )

        # Use report-only mode in DEBUG, enforce in production
        if settings.DEBUG:
            response["Content-Security-Policy-Report-Only"] = csp_header
        else:
            response["Content-Security-Policy"] = csp_header

        # Additional security headers
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response
