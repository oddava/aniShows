"""
Production settings for aniShows project.
"""

import os
from .base import *

# =============================================================================
# SECURITY SETTINGS
# =============================================================================

DEBUG = False

# HTTPS/SSL Settings
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "False") == "True"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Cookie Security
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Security Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# HSTS
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# =============================================================================
# EMAIL BACKEND
# =============================================================================

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")

# =============================================================================
# CORS SETTINGS
# =============================================================================

cors_origins = [
    origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if origin.strip()
]

if not cors_origins:
    raise ValueError(
        "CORS_ALLOWED_ORIGINS environment variable must be set in production. "
        "Example: CORS_ALLOWED_ORIGINS=https://anishows.com,https://www.anishows.com"
    )

CORS_ALLOWED_ORIGINS = cors_origins
CORS_ALLOW_CREDENTIALS = True

# =============================================================================
# CSRF SETTINGS
# =============================================================================

csrf_origins = [origin for origin in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if origin]

if not csrf_origins:
    raise ValueError(
        "CSRF_TRUSTED_ORIGINS environment variable must be set in production. "
        "Example: CSRF_TRUSTED_ORIGINS=https://anishows.com,https://www.anishows.com"
    )

CSRF_TRUSTED_ORIGINS = csrf_origins

# =============================================================================
# DATABASE CONNECTION POOLING
# =============================================================================

# CONN_MAX_AGE is set in base.py (600s). Only add production-specific overrides here.

# Connection health check to prevent stale connections
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# Note: DISABLE_SERVER_SIDE_CURSORS is intentionally NOT set.
# It's only needed with PgBouncer in transaction/statement pooling mode.
# Without PgBouncer, server-side cursors provide better memory efficiency
# for large querysets (e.g. paginated anime lists, export queries).

# =============================================================================
# LOGGING
# =============================================================================

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
        "apps.animes": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.users.views.auth": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
