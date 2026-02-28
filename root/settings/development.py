"""
Development settings for aniShows project.
"""

from .base import *

# =============================================================================
# DEBUG SETTINGS
# =============================================================================

DEBUG = True

# =============================================================================
# INTERNAL IPS
# =============================================================================

INTERNAL_IPS = [
    "127.0.0.1",
]

# =============================================================================
# EMAIL BACKEND
# =============================================================================

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")

# =============================================================================
# CORS SETTINGS
# =============================================================================

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

CORS_ALLOW_CREDENTIALS = True

# =============================================================================
# CSRF SETTINGS
# =============================================================================

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# =============================================================================
# DEBUG TOOLBAR
# =============================================================================

INSTALLED_APPS.append("debug_toolbar")
INSTALLED_APPS.append("drf_spectacular")
MIDDLEWARE.append("debug_toolbar.middleware.DebugToolbarMiddleware")

# =============================================================================
# DRF SPECTACULAR (Swagger/OpenAPI)
# =============================================================================

SPECTACULAR_SETTINGS = {
    "TITLE": "aniShows API",
    "DESCRIPTION": "Anime tracking and discovery platform API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
}

# =============================================================================
# LOGGING
# =============================================================================

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "apps.animes": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": False,
        },
        "apps.users.views.auth": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": False,
        },
        "apps.animes": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": False,
        },
    },
}
