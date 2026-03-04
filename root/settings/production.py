"""
Production settings for aniShows project.
"""

import os
from .base import *

import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.redis import RedisIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

# =============================================================================
# SENTRY ERROR MONITORING
# =============================================================================

SENTRY_DSN = os.getenv("SENTRY_DSN", "")

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        release=os.getenv("SENTRY_RELEASE", ""),
        integrations=[
            DjangoIntegration(
                transaction_style="url",
                middleware_spans=True,
            ),
            CeleryIntegration(
                monitor_beat_tasks=True,
            ),
            RedisIntegration(),
            LoggingIntegration(
                level=None,  # Don't capture breadcrumbs from logging
                event_level="ERROR",  # Send ERROR+ logs as events
            ),
        ],
        # Performance monitoring
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        # Profile 10% of sampled transactions
        profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.1")),
        # Send request bodies (scrub PII separately)
        send_default_pii=False,
        # Attach server name for identification
        server_name=os.getenv("SENTRY_SERVER_NAME", "anishows-web"),
        # Filter out health check noise
        before_send=lambda event, hint: _filter_sentry_event(event, hint),
        before_send_transaction=lambda event, hint: _filter_sentry_transaction(event, hint),
    )


def _filter_sentry_event(event, hint):
    """Filter out noisy or irrelevant error events."""
    # Ignore DisallowedHost errors (bot scanners)
    if "logger" in event and event["logger"] == "django.security.DisallowedHost":
        return None
    return event


def _filter_sentry_transaction(event, hint):
    """Filter out noisy transaction events."""
    transaction_name = event.get("transaction", "")
    # Skip health check and metrics endpoints
    if transaction_name in ("/api/v1/health/", "/metrics"):
        return None
    return event


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
