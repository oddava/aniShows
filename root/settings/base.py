"""
Base Django settings for aniShows project.

Common settings shared across all environments.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Build paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load environment variables
env_path = BASE_DIR / ".env"
if env_path.exists():
    load_dotenv(env_path)

# =============================================================================
# CORE SETTINGS
# =============================================================================

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
DEBUG = False  # Overridden in environment-specific files
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,web").split(",")

# Frontend URL for OAuth callbacks
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# =============================================================================
# APPLICATION DEFINITION
# =============================================================================

DJANGO_APPS = [
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework.authtoken",
    "rest_framework_simplejwt",
    "django_filters",
    "django_celery_beat",
    "corsheaders",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "dj_rest_auth",
    "dj_rest_auth.registration",
    "storages",
    "imagekit",
]

LOCAL_APPS = [
    "core",
    "users",
    "anime",
    "api",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# =============================================================================
# AUTHENTICATION
# =============================================================================

AUTH_USER_MODEL = "users.CustomUser"
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

# Django allauth config
ACCOUNT_LOGIN_METHODS = {"email", "username"}

ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_LOGIN_ON_GET = True
LOGIN_REDIRECT_URL = "/browse/"
ACCOUNT_LOGOUT_REDIRECT_URL = "/"
SITE_ID = 1

SOCIALACCOUNT_ADAPTER = "users.adapters.MySocialAccountAdapter"

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "key": "",
        },
        "SCOPE": [
            "profile",
            "email",
        ],
        "AUTH_PARAMS": {
            "access_type": "online",
        },
        "VERIFIED_EMAIL": True,
    }
}

# REST_AUTH Configuration
REST_AUTH = {
    "USE_JWT": True,
    "JWT_AUTH_COOKIE": None,
    "JWT_AUTH_REFRESH_COOKIE": None,
    "SESSION_LOGIN": False,
}

# =============================================================================
# MIDDLEWARE
# =============================================================================

MIDDLEWARE = [
    "api.middleware.csp_middleware.CSPMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.LoggingMiddleware",
    "core.middleware.AdminAuditMiddleware",
    "core.middleware.ExceptionLoggingMiddleware",
    "api.middleware.activity_middleware.UserActivityMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.middleware.locale.LocaleMiddleware",
]

# =============================================================================
# URLS & TEMPLATES
# =============================================================================

ROOT_URLCONF = "root.urls"
WSGI_APPLICATION = "root.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# =============================================================================
# DATABASE
# =============================================================================

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME"),
        "USER": os.getenv("DB_USER"),
        "PASSWORD": os.getenv("DB_PASSWORD"),
        "HOST": os.getenv("DB_HOST"),
        "PORT": os.getenv("DB_PORT"),
    }
}

# =============================================================================
# PASSWORD VALIDATION
# =============================================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# =============================================================================
# INTERNATIONALIZATION
# =============================================================================

LANGUAGE_CODE = "en-us"
LANGUAGES = [
    ("en", "English"),
    ("uz", "Uzbek"),
]
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# =============================================================================
# STATIC & MEDIA FILES
# =============================================================================

USE_S3 = os.getenv("USE_S3") == "True"

if USE_S3:
    # AWS/MinIO settings
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
    AWS_STORAGE_BUCKET_NAME = os.getenv("AWS_STORAGE_BUCKET_NAME")
    AWS_S3_REGION_NAME = os.getenv("AWS_S3_REGION_NAME")
    AWS_S3_ENDPOINT_URL = os.getenv("AWS_S3_ENDPOINT_URL")
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_DEFAULT_ACL = None
    AWS_S3_FILE_OVERWRITE = False

    MINIO_PUBLIC_DOMAIN = os.getenv("MINIO_PUBLIC_DOMAIN", "localhost:9000")

    if "minio" in (AWS_S3_ENDPOINT_URL or ""):
        AWS_S3_CUSTOM_DOMAIN = MINIO_PUBLIC_DOMAIN
        AWS_S3_USE_SSL = os.getenv("MINIO_USE_SSL", "False") == "True"
        AWS_S3_URL_PROTOCOL = "https:" if AWS_S3_USE_SSL else "http:"
    else:
        AWS_S3_CUSTOM_DOMAIN = f"{AWS_STORAGE_BUCKET_NAME}.s3.amazonaws.com"
        AWS_S3_URL_PROTOCOL = "https:"

    AWS_S3_OBJECT_PARAMETERS = {"CacheControl": "max-age=86400"}

    # ImageKit configuration - store generated thumbnails in MinIO
    IMAGEKIT_DEFAULT_FILE_STORAGE = "root.storage_backends.MediaStorage"
    IMAGEKIT_CACHE_BACKEND = "default"
    IMAGEKIT_CACHE_PREFIX = "CACHE/images"
    IMAGEKIT_DEFAULT_CACHEFILE_STRATEGY = "imagekit.cachefiles.strategies.Optimistic"

    STATIC_LOCATION = "static"
    STATIC_URL = f"{AWS_S3_URL_PROTOCOL}//{AWS_S3_CUSTOM_DOMAIN}/{STATIC_LOCATION}/"

    PUBLIC_MEDIA_LOCATION = "media"
    MEDIA_URL = (
        f"{AWS_S3_URL_PROTOCOL}//{AWS_S3_CUSTOM_DOMAIN}/{PUBLIC_MEDIA_LOCATION}/"
    )
    DEFAULT_FILE_STORAGE = "root.storage_backends.MediaStorage"
else:
    STATIC_URL = "/static/"
    STATIC_ROOT = os.path.join(BASE_DIR, "static")
    STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

    MEDIA_URL = "/media/"
    MEDIA_ROOT = os.path.join(BASE_DIR, "media")
    DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"

    # ImageKit configuration for local development
    IMAGEKIT_DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
    IMAGEKIT_CACHE_BACKEND = "default"
    IMAGEKIT_CACHE_PREFIX = "CACHE/images"
    IMAGEKIT_DEFAULT_CACHEFILE_STRATEGY = "imagekit.cachefiles.strategies.Optimistic"

# =============================================================================
# DEFAULT PRIMARY KEY
# =============================================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# =============================================================================
# REQUEST SIZE LIMITS (DoS Prevention)
# =============================================================================

DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024  # 2MB max request body
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024  # 2MB max in-memory file
DATA_UPLOAD_MAX_NUMBER_FIELDS = 1000  # Max number of form fields
DATA_UPLOAD_MAX_NUMBER_FILES = 10  # Max number of file uploads

# =============================================================================
# EMAIL SETTINGS (base configuration)
# =============================================================================

EMAIL_HOST = os.getenv("EMAIL_HOST")
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", 587))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True") == "True"
EMAIL_USE_SSL = os.getenv("EMAIL_USE_SSL", "False") == "True"
DEFAULT_FROM_EMAIL = os.getenv("EMAIL_HOST_USER", "webmaster@localhost")

# =============================================================================
# DJANGO REST FRAMEWORK
# =============================================================================

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/minute",
        "user": "100/minute",
        "user_profile_lookup": "60/minute",
        "anime_list": "120/minute",
        "review_access": "60/minute",
        "login": "5/minute",
        "register": "3/hour",
        "password_reset": "3/hour",
        "user_actions": "120/minute",
        "admin_actions": "60/minute",
        "strict_user": "10/minute",
    },
}

# =============================================================================
# JWT SETTINGS
# =============================================================================

from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "ISSUER": os.getenv("JWT_ISSUER", "anishows.com"),
    "AUDIENCE": os.getenv("JWT_AUDIENCE", "anishows-api"),
    "ALGORITHM": "HS256",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
}

# =============================================================================
# REDIS CACHE (with authentication support)
# =============================================================================

# Build Redis URL with password if provided
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
REDIS_DB = os.getenv("REDIS_DB", "0")

if REDIS_PASSWORD:
    REDIS_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
else:
    # Fallback to REDIS_URL env var for backward compatibility
    REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    }
}

# =============================================================================
# CELERY CONFIGURATION (uses authenticated REDIS_URL)
# =============================================================================

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_ACCEPT_CONTENT = ["application/json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # =========================================================================
    # UNIFIED TASK SCHEDULE
    # =========================================================================
    #
    # Hourly Tasks (Staggered to avoid API spikes)
    # -------------------------------------------------------------------------
    "sync-trending-hourly": {
        "task": "anime.tasks.sync.sync_anime_catalog",
        "schedule": crontab(minute=5),  # 5 min past hour
        "kwargs": {"sync_type": "trending", "limit": 50},
        "options": {"queue": "default"},
    },
    "sync-airing-workflow-hourly": {
        "task": "anime.tasks.airing.sync_airing_workflow",
        "schedule": crontab(minute=30),  # 30 min past hour
        "kwargs": {"phases": ["sync"], "batch_size": 100},
        "options": {"queue": "default"},
    },
    # Daily Tasks (Low-traffic hours: 2 AM - 7 AM)
    # -------------------------------------------------------------------------
    "sync-seasonal-daily": {
        "task": "anime.tasks.sync.sync_anime_catalog",
        "schedule": crontab(hour=2, minute=0),  # 2:00 AM
        "kwargs": {"sync_type": "seasonal", "limit": 100},
        "options": {"queue": "default"},
    },
    "enrich-metadata-daily": {
        "task": "anime.tasks.metadata.enrich_metadata",
        "schedule": crontab(hour=3, minute=0),  # 3:00 AM
        "kwargs": {"mode": "backfill", "batch_size": 100},
        "options": {"queue": "low_priority"},
    },
    "airing-workflow-cleanup-daily": {
        "task": "anime.tasks.airing.sync_airing_workflow",
        "schedule": crontab(hour=4, minute=0),  # 4:00 AM
        "kwargs": {"phases": ["cleanup", "backfill"], "batch_size": 100},
        "options": {"queue": "low_priority"},
    },
    "generate-recommendations-daily": {
        "task": "anime.tasks.recommendations.generate_recommendations",
        "schedule": crontab(hour=5, minute=0),  # 5:00 AM
        "kwargs": {"limit": 10},
        "options": {"queue": "low_priority"},
    },
    "sync-themes-daily": {
        "task": "anime.tasks.themes.sync_theme_songs",
        "schedule": crontab(hour=6, minute=0),  # 6:00 AM
        "kwargs": {"limit": 500},  # Increased from 100 to 500
        "options": {"queue": "default"},
    },
    "sync-themes-retry": {
        "task": "anime.tasks.themes.sync_theme_songs",
        "schedule": crontab(hour=18, minute=0),  # 6:00 PM - retry failed
        "kwargs": {"limit": 200, "retry_failed": True},
        "options": {"queue": "low_priority"},
    },
    "user-maintenance-daily": {
        "task": "users.tasks.run_user_maintenance_workflow",
        "schedule": crontab(hour=7, minute=0),  # 7:00 AM
        "kwargs": {
            "cleanup_unverified": True,
            "cleanup_imports": True,
            "unverified_days": 7,
            "import_days": 30,
        },
        "options": {"queue": "low_priority"},
    },
    # Weekly Tasks
    # -------------------------------------------------------------------------
    "sync-upcoming-weekly": {
        "task": "anime.tasks.sync.sync_anime_catalog",
        "schedule": crontab(day_of_week=0, hour=3, minute=30),  # Sunday 3:30 AM
        "kwargs": {"sync_type": "next_season", "limit": 100},
        "options": {"queue": "default"},
    },
    # =========================================================================
    # LEGACY TASKS (Backward Compatibility)
    # =========================================================================
    # These tasks are deprecated in favor of unified tasks above.
    # They will be removed in a future version.
    #
    # "sync-trending-every-hour": {
    #     "task": "anime.tasks.sync_trending_anime",
    #     "schedule": crontab(minute=5),
    #     "args": (50,),
    #     "options": {"queue": "default"},
    # },
}

# =============================================================================
# JAZZMIN SETTINGS
# =============================================================================

JAZZMIN_SETTINGS = {
    "site_title": "aniShows Admin",
    "site_header": "aniShows",
    "site_brand": "aniShows",
    "site_logo": "books/img/logo.png",
    "login_logo": None,
    "login_logo_dark": None,
    "site_logo_classes": "img-circle",
    "site_icon": None,
    "welcome_sign": "Welcome to the library",
    "copyright": "Acme Library Ltd",
    "search_model": ["auth.User", "auth.Group"],
    "user_avatar": None,
    "topmenu_links": [
        {"name": "Home", "url": "admin:index", "permissions": ["auth.view_user"]},
        {
            "name": "Support",
            "url": "https://github.com/farridav/django-jazzmin/issues",
            "new_window": True,
        },
        {"model": "auth.User"},
        {"app": "anime"},
    ],
    "usermenu_links": [
        {
            "name": "Support",
            "url": "https://github.com/farridav/django-jazzmin/issues",
            "new_window": True,
        },
        {"model": "auth.user"},
    ],
    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],
    "order_with_respect_to": ["auth", "users", "anime"],
    "custom_links": {},
    "icons": {
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.Group": "fas fa-users",
    },
    "default_icon_parents": "fas fa-chevron-circle-right",
    "default_icon_children": "fas fa-circle",
    "related_modal_active": False,
    "ui_tweaks": {
        "theme": "darkly",
        "dark_mode_theme": "darkly",
    },
    "custom_css": None,
    "custom_js": None,
    "use_google_fonts_cdn": True,
    "show_ui_builder": True,
    "changeform_format": "horizontal_tabs",
    "changeform_format_overrides": {
        "auth.user": "collapsible",
        "auth.group": "vertical_tabs",
    },
    "language_chooser": True,
}
