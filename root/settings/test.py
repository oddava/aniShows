
import os

os.environ.pop("PROMETHEUS_MULTIPROC_DIR", None)

from .base import *

# =============================================================================
# TEST SETTINGS
# =============================================================================

DEBUG = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("TEST_DB_NAME", os.getenv("DB_NAME", "anishows_db")),
        "USER": os.getenv("TEST_DB_USER", os.getenv("DB_USER", "postgres")),
        "PASSWORD": os.getenv("TEST_DB_PASSWORD", os.getenv("DB_PASSWORD", "1")),
        "HOST": os.getenv("TEST_DB_HOST", "db"),
        "PORT": os.getenv("TEST_DB_PORT", "5432"),
        "CONN_MAX_AGE": 0,
        # Fail a lock wait instead of hanging: pytest-timeout's signal can't
        # interrupt a blocked libpq call (e.g. two connections in one test).
        "OPTIONS": {"options": "-c lock_timeout=30000"},
    }
}
DATABASES["default"]["TEST"] = {
    "NAME": os.getenv("TEST_DB_DATABASE"),
}
ALLOWED_HOSTS = [*ALLOWED_HOSTS, "testserver"]

# Use very high throttle rates during tests (effectively disabled), derived from
# base so new scopes can't go missing. Scopes whose limits are under test keep
# their real rates.
_THROTTLE_SCOPES_UNDER_TEST = {"social_links"}
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {
        scope: rate if scope in _THROTTLE_SCOPES_UNDER_TEST else "10000/minute"
        for scope, rate in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"].items()
    },
}

# Don't randomly sample successful requests into the (eager) request-log task:
# it adds queries to ~5% of requests and makes query-count tests flaky.
REQUEST_LOG_SUCCESS_SAMPLE_RATE = 0.0

# Use synchronous email backend for tests
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Disable Celery task execution during tests
# Tasks will be executed synchronously but errors will be caught
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = False
# Disable results to avoid backend configuration issues
CELERY_RESULT_BACKEND = None
ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED = False
# Creating an Anime would otherwise run eager metadata enrichment, which calls
# Jikan and backs off for ~15s once the network guard (conftest.py) fails it.
ANIME_METADATA_AUTO_ENRICH_ENABLED = False
RETRY_BACKOFF_SCALE = 0

# Use console cache for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}
# Avoid cross-test pollution from cached runtime policy settings.
ADMIN_SETTINGS_USE_CACHE = False

# Speed up password hashing in tests
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# Disable logging during tests
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "handlers": {},
    "loggers": {},
}
