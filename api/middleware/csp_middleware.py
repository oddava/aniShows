"""Content Security Policy middleware."""

from django.utils.deprecation import MiddlewareMixin


class CSPMiddleware(MiddlewareMixin):
    """
    Add Content Security Policy headers.

    Add to settings.py MIDDLEWARE (before SecurityMiddleware):
    'api.middleware.csp_middleware.CSPMiddleware',
    """

    def process_response(self, request, response):
        # Only add CSP in production
        from django.conf import settings

        if settings.DEBUG:
            return response

        # Base CSP directives
        csp_directives = {
            "default-src": ["'self'"],
            "script-src": [
                "'self'",
                "'unsafe-inline'",
                "https://www.googletagmanager.com",
                "https://www.google-analytics.com",
            ],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "https:", "http:"],
            "connect-src": ["'self'", "https://www.google-analytics.com"],
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

        response["Content-Security-Policy"] = csp_header

        # Additional security headers
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response
