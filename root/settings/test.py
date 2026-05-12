
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
    }
}
DATABASES["default"]["TEST"] = {
    "NAME": os.getenv("TEST_DB_DATABASE"),
}
ALLOWED_HOSTS = [*ALLOWED_HOSTS, "testserver"]

# Use very high throttle rates during tests (effectively disabled)
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {
        "anon": "10000/hour",
        "user": "10000/hour",
        "user_profile_lookup": "10000/minute",
        "anime_list": "10000/minute",
        "review_access": "10000/minute",
        "login": "10000/minute",
        "register": "10000/hour",
        "password_reset": "10000/hour",
        "user_actions": "10000/minute",
        "admin_actions": "10000/minute",
        "strict_user": "10000/minute",
        "forum_write": "10000/minute",
        "forum_like": "10000/minute",
    },
}

# Use synchronous email backend for tests
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Disable Celery task execution during tests
# Tasks will be executed synchronously but errors will be caught
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = False
# Disable results to avoid backend configuration issues
CELERY_RESULT_BACKEND = None
ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED = False

# Use console cache for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
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
