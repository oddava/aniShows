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

# CORS settings - require explicit configuration in production
cors_origins_str = os.getenv("CORS_ALLOWED_ORIGINS", "")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]

# Only enforce CORS origins if explicitly configured
# If not set, CORS will be permissive but with security warnings
if cors_origins:
    CORS_ALLOWED_ORIGINS = cors_origins
    CORS_ALLOW_CREDENTIALS = True
else:
    # Log warning but don't crash - this allows admin to work
    # while requiring proper CORS setup for API access
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOW_CREDENTIALS = True

# =============================================================================
# CSRF SETTINGS
# =============================================================================

csrf_origins_str = os.getenv("CSRF_TRUSTED_ORIGINS", "")
csrf_origins = [origin.strip() for origin in csrf_origins_str.split(",") if origin.strip()]

# CSRF origins are critical for admin panel to work
# Build from CORS origins if not explicitly set
if csrf_origins:
    CSRF_TRUSTED_ORIGINS = csrf_origins
elif cors_origins:
    CSRF_TRUSTED_ORIGINS = cors_origins
else:
    # Allow admin to work by not enforcing CSRF origins
    # This is less secure but prevents complete lockout
    CSRF_TRUSTED_ORIGINS = []

# =============================================================================
# DATABASE CONNECTION POOLING
# =============================================================================

DATABASES["default"]["CONN_MAX_AGE"] = 600  # Keep connections for 10 minutes

# Connection health check to prevent stale connections
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# Disable server-side cursors to prevent connection issues with pgbouncer/pooling
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True

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
