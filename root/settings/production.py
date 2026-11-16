"""Production settings for aniShows project.

Deploy modes (docs/deploy/tunnel.md): Caddy is the only proxy the app trusts,
in public mode (Caddy owns 80/443) and in tunnel mode (Cloudflare Tunnel ->
Caddy -> app). Every production variable is listed in .env.production.example.
"""

import os

import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.redis import RedisIntegration

from root.log_formatting import scrub_sentry_breadcrumb, scrub_sentry_event

from .base import *


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_number(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return float(raw)


# =============================================================================
# SENTRY ERROR MONITORING
# =============================================================================

SENTRY_DSN = os.getenv("SENTRY_DSN", "")


def _filter_sentry_event(event, hint):
    """Drop noisy events, then scrub tokens and credentials from the rest."""
    # Ignore DisallowedHost errors (bot scanners)
    if "logger" in event and event["logger"] == "django.security.DisallowedHost":
        return None

    logger_name = event.get("logger", "")
    message = (event.get("message") or "").lower()
    logentry = event.get("logentry") or {}
    formatted = (logentry.get("formatted") or "").lower()

    # Ignore expected Gunicorn worker shutdown messages during deploy/reload.
    if logger_name == "gunicorn.error":
        combined = f"{message} {formatted}"
        if "was sent sigterm" in combined or "was sent sigquit" in combined:
            return None

    return scrub_sentry_event(event)


def _filter_sentry_transaction(event, hint):
    """Filter out noisy transaction events."""
    transaction_name = event.get("transaction", "")
    # Skip health check and metrics endpoints
    if transaction_name in ("/api/v1/health/", "/api/v1/health/ready/", "/metrics"):
        return None
    return scrub_sentry_event(event)


def _filter_sentry_breadcrumb(crumb, hint):
    return scrub_sentry_breadcrumb(crumb)


if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        # The image's commit unless set explicitly.
        release=os.getenv("SENTRY_RELEASE", "") or GIT_SHA or None,
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
        # Performance monitoring: 5% of transactions; profiling off by default
        # (both cost quota and CPU on a small shared host).
        traces_sample_rate=_env_number("SENTRY_TRACES_SAMPLE_RATE", 0.05),
        profiles_sample_rate=_env_number("SENTRY_PROFILES_SAMPLE_RATE", 0.0),
        # No cookies, user IPs or request bodies; tokens in URLs are scrubbed
        # by the hooks below.
        send_default_pii=False,
        # Attach server name for identification
        server_name=os.getenv("SENTRY_SERVER_NAME", "anishows-web"),
        before_send=_filter_sentry_event,
        before_send_transaction=_filter_sentry_transaction,
        before_breadcrumb=_filter_sentry_breadcrumb,
    )


# =============================================================================
# SECURITY SETTINGS
# =============================================================================

DEBUG = False

# HTTPS/SSL Settings. Caddy sets X-Forwarded-Proto: its own scheme in public
# mode, Cloudflare's ("https") in tunnel mode, so this never loops behind the
# tunnel. The health paths stay reachable over plain HTTP for probes.
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "True") == "True"
SECURE_REDIRECT_EXEMPT = [
    r"^api/v1/health/$",
    r"^api/v1/health/ready/$",
]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Cookie Security
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Security Headers
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# HSTS. Defaults are the previous hard-coded values (1 year, subdomains,
# preload). Owner decision G7 Q1: preload and includeSubDomains reach every
# subdomain of a domain other projects may share, and preload is hard to undo.
# deploy-prod.sh builds Caddy's header from the same variables.
SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000") or "31536000")
SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_flag("SECURE_HSTS_INCLUDE_SUBDOMAINS", True)
SECURE_HSTS_PRELOAD = _env_flag("SECURE_HSTS_PRELOAD", True)

# =============================================================================
# ALLOWED HOSTS
# =============================================================================

# ALLOWED_HOSTS (base.py) holds the public names. Probes inside the compose
# network address the app by loopback or service name: the Docker healthcheck
# (localhost:8000), Caddy's upstream health checks (web:8000) and the deploy
# smoke test. Without these names each probe gets DisallowedHost (400), every
# replica turns unhealthy and Caddy ejects them all. They are not reachable
# from outside: Caddy proxies only the public site (public mode) or what
# Cloudflare routes (tunnel mode). ALLOWED_HOSTS_INTERNAL="" turns this off.
ALLOWED_HOSTS_INTERNAL = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS_INTERNAL", "localhost,127.0.0.1,web").split(",")
    if host.strip()
]
ALLOWED_HOSTS = [
    *ALLOWED_HOSTS,
    *(host for host in ALLOWED_HOSTS_INTERNAL if host not in ALLOWED_HOSTS),
]

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
# CLIENT IP FOR THROTTLING
# =============================================================================

# Exactly one proxy the app trusts (Caddy) sits in front of it, in both deploy
# modes, and it sends a single X-Forwarded-For entry: the real client (behind
# Cloudflare Tunnel, Caddy takes it from CF-Connecting-IP; see Caddyfile.prod).
# Rate limits key on that last entry: by default DRF uses the whole header,
# which a client can vary at will to dodge the login and sign-up throttles.
# Keep this at 1 unless the chain in docs/deploy/tunnel.md changes.
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": int(os.getenv("DRF_NUM_PROXIES", "1"))}

# =============================================================================
# CSRF SETTINGS
# =============================================================================

csrf_origins = [
    origin.strip() for origin in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if origin.strip()
]

if not csrf_origins:
    raise ValueError(
        "CSRF_TRUSTED_ORIGINS environment variable must be set in production. "
        "Example: CSRF_TRUSTED_ORIGINS=https://anishows.com,https://www.anishows.com"
    )

CSRF_TRUSTED_ORIGINS = csrf_origins

# =============================================================================
# DATABASE CONNECTION POOLING
# =============================================================================

# CONN_MAX_AGE (600 s) and the optional DB_POOL_MAX_SIZE pool are set in base.py;
# DB_SSLMODE in features/ops.py.

# Connection health check to prevent stale connections
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# =============================================================================
# REQUEST ID
# =============================================================================

# First, so every later middleware and view logs with the id (root/request_id.py).
MIDDLEWARE = ["root.request_id.RequestIdMiddleware", *MIDDLEWARE]

# =============================================================================
# LOGGING
# =============================================================================

# LOG_FORMAT (features/ops.py): "json" (default) or "text" (the old format).
# Gunicorn's own loggers are configured in gunicorn.conf.py (same formatter).
# Celery keeps Django's handlers instead of replacing the root logger's, so
# worker and beat lines are JSON too.
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

_LOG_FORMATTERS = {
    "json": {"()": "root.log_formatting.JsonFormatter"},
    "text": {
        "format": "{levelname} {asctime} {name} [{request_id}] {message}",
        "style": "{",
    },
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {"()": "root.log_formatting.RequestIdFilter"},
    },
    "formatters": {
        "default": _LOG_FORMATTERS[LOG_FORMAT],
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "filters": ["request_id"],
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
        # Application code logs through apps.shared.logger ("anishows.*").
        "anishows": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}
