"""
Test settings for aniShows project.
"""

import sys
from .base import *

# =============================================================================
# TEST SETTINGS
# =============================================================================

DEBUG = True

# Use in-memory SQLite for faster tests
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

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

# Use console cache for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

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
