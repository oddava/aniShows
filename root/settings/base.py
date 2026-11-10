"""
Base Django settings for aniShows project.

Common settings shared across all environments.
"""

import os
from pathlib import Path

from dotenv import load_dotenv


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse a boolean-like environment variable."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    """Parse an integer env value with a safe default."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    """Parse a float env value with a safe default."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw.strip())
    except (TypeError, ValueError):
        return default


def _parse_csv(value: str) -> list[str]:
    """Parse comma-separated env values into a cleaned list."""
    return [item.strip() for item in value.split(",") if item.strip()]


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
# django-cors-headers' own default; development.py and production.py set the real list.
CORS_ALLOWED_ORIGINS: list[str] = []
JIKAN_BASE_URL = os.getenv("JIKAN_BASE_URL", "https://api.jikan.moe/v4").strip().rstrip("/")

# Application tuning defaults
# Non-secret runtime tuning values are defined here in settings.py with Python
# defaults, but they may still be overridden by environment variables for a
# specific deployment or by a future runtime config/admin model.

# Runtime controls for request logging overhead and policy checks
REQUEST_LOGGING_ENABLED = _env_bool("REQUEST_LOGGING_ENABLED", True)
REQUEST_LOG_SUCCESS_SAMPLE_RATE = min(
    max(_env_float("REQUEST_LOG_SUCCESS_SAMPLE_RATE", 0.05), 0.0),
    1.0,
)
REQUEST_LOG_INCLUDE_QUERY_PARAMS = _env_bool("REQUEST_LOG_INCLUDE_QUERY_PARAMS", False)
REQUEST_LOG_INCLUDE_USER_AGENT = _env_bool("REQUEST_LOG_INCLUDE_USER_AGENT", True)
ADMIN_SETTINGS_USE_CACHE = _env_bool("ADMIN_SETTINGS_USE_CACHE", True)
ADMIN_SETTINGS_LOCAL_CACHE_TTL_SECONDS = max(
    _env_float("ADMIN_SETTINGS_LOCAL_CACHE_TTL_SECONDS", 2.0),
    0.0,
)
NOTIFICATION_UNREAD_CACHE_TTL = _env_int("NOTIFICATION_UNREAD_CACHE_TTL", 86400)
GOOGLE_SAFE_BROWSING_FAIL_OPEN = _env_bool("GOOGLE_SAFE_BROWSING_FAIL_OPEN", False)
PUBLIC_API_CACHE_LOCK_TTL_SECONDS = _env_int("PUBLIC_API_CACHE_LOCK_TTL_SECONDS", 120)
PUBLIC_API_CACHE_STALE_TTL_SECONDS = _env_int("PUBLIC_API_CACHE_STALE_TTL_SECONDS", 900)
PUBLIC_API_CACHE_WAIT_TIMEOUT_MS = _env_int("PUBLIC_API_CACHE_WAIT_TIMEOUT_MS", 30000)
PUBLIC_API_CACHE_WAIT_POLL_INTERVAL_MS = _env_int("PUBLIC_API_CACHE_WAIT_POLL_INTERVAL_MS", 25)
PUBLIC_API_CACHE_TTL_JITTER_SECONDS = _env_int("PUBLIC_API_CACHE_TTL_JITTER_SECONDS", 30)
IMAGEKIT_GENERATE_DURING_REQUESTS = _env_bool("IMAGEKIT_GENERATE_DURING_REQUESTS", False)
FORUM_VIEW_BUFFER_TTL_SECONDS = _env_int("FORUM_VIEW_BUFFER_TTL_SECONDS", 7200)
FORUM_VIEW_FLUSH_BATCH_SIZE = _env_int("FORUM_VIEW_FLUSH_BATCH_SIZE", 500)
USER_STATS_REFRESH_DEDUPE_TTL_SECONDS = max(
    _env_int("USER_STATS_REFRESH_DEDUPE_TTL_SECONDS", 30),
    5,
)
USER_STATS_BACKSTOP_STALE_MINUTES = max(_env_int("USER_STATS_BACKSTOP_STALE_MINUTES", 180), 15)
USER_STATS_BACKSTOP_BATCH_SIZE = max(_env_int("USER_STATS_BACKSTOP_BATCH_SIZE", 250), 1)
USER_STATS_BACKSTOP_LOCK_SECONDS = max(_env_int("USER_STATS_BACKSTOP_LOCK_SECONDS", 1800), 60)
MEDIA_SELF_HEAL_BATCH_SIZE = max(_env_int("MEDIA_SELF_HEAL_BATCH_SIZE", 25), 1)
MEDIA_SELF_HEAL_MAX_QUEUE_DEPTH = max(_env_int("MEDIA_SELF_HEAL_MAX_QUEUE_DEPTH", 100), 1)
MEDIA_SELF_HEAL_LOCK_SECONDS = max(_env_int("MEDIA_SELF_HEAL_LOCK_SECONDS", 1800), 60)
OFFLINE_RECONCILE_BATCH_SIZE = max(_env_int("OFFLINE_RECONCILE_BATCH_SIZE", 25), 1)
OFFLINE_RECONCILE_CHUNK_SIZE = max(_env_int("OFFLINE_RECONCILE_CHUNK_SIZE", 100), 1)
OFFLINE_RECONCILE_MAX_ROUNDS = max(_env_int("OFFLINE_RECONCILE_MAX_ROUNDS", 4), 1)
OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES = max(
    _env_int("OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES", 15),
    1,
)
OFFLINE_RECONCILE_INTER_STAGE_DELAY_SECONDS = max(
    _env_int("OFFLINE_RECONCILE_INTER_STAGE_DELAY_SECONDS", 60),
    0,
)
OFFLINE_RECONCILE_WORKFLOW_LOCK_SECONDS = max(
    _env_int("OFFLINE_RECONCILE_WORKFLOW_LOCK_SECONDS", 7200),
    60,
)
OFFLINE_IMPORT_TRENDING_RANK_LIMIT = _env_int("OFFLINE_IMPORT_TRENDING_RANK_LIMIT", 50)

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
    "channels",
    "rest_framework",
    "rest_framework.authtoken",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
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
    "apps.core.apps.CoreConfig",
    "apps.users.apps.UsersConfig",
    "apps.animes.apps.AnimeConfig",
    "apps.forums.apps.ForumsConfig",
    "apps.admin_api.apps.AdminApiConfig",
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
SOCIALACCOUNT_LOGIN_ON_GET = False
LOGIN_REDIRECT_URL = "/browse/"
ACCOUNT_LOGOUT_REDIRECT_URL = "/"
SITE_ID = 1

SOCIALACCOUNT_ADAPTER = "apps.users.adapters.MySocialAccountAdapter"

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
    # Social login views set our own refresh cookie (apps.users.auth_cookies).
    "JWT_AUTH_REFRESH_COOKIE": None,
    "JWT_AUTH_HTTPONLY": True,
    "JWT_TOKEN_CLAIMS_SERIALIZER": "apps.users.views.auth.CustomTokenObtainPairSerializer",
    "SESSION_LOGIN": False,
}

# Refresh JWT cookie (see apps/users/auth_cookies.py). Plain HTTP in dev only.
JWT_REFRESH_COOKIE_SECURE = True

# =============================================================================
# MIDDLEWARE
# =============================================================================

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.users.middleware.csp_middleware.CSPMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.core.middleware.SiteControlMiddleware",
    "apps.core.middleware.LoggingMiddleware",
    "apps.core.middleware.AdminAuditMiddleware",
    "apps.users.middleware.activity_middleware.UserActivityMiddleware",
    "apps.core.middleware.ExceptionLoggingMiddleware",
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
ASGI_APPLICATION = "root.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
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

DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_PORT = os.getenv("DB_PORT")
DB_HOST = os.getenv("DB_HOST", "db")

# Django's native connection pool (psycopg 3), off when 0 (dev, tests). The
# size is per process, so total connections are about
# max_size x (gunicorn workers + celery processes + beat); keep that under
# Postgres' max_connections.
DB_POOL_MAX_SIZE = _env_int("DB_POOL_MAX_SIZE", 0)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": DB_NAME,
        "USER": DB_USER,
        "PASSWORD": DB_PASSWORD,
        "HOST": DB_HOST,
        "PORT": DB_PORT,
        "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "600")),
    }
}

if DB_POOL_MAX_SIZE:
    # Django refuses persistent connections together with a pool.
    DATABASES["default"]["CONN_MAX_AGE"] = 0
    DATABASES["default"]["OPTIONS"] = {
        "pool": {"min_size": 1, "max_size": DB_POOL_MAX_SIZE, "timeout": 10},
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
CDN_BASE_URL = os.getenv("CDN_BASE_URL", "").strip().rstrip("/")
STATIC_CDN_URL = os.getenv("STATIC_CDN_URL", CDN_BASE_URL).strip().rstrip("/")
MEDIA_CDN_URL = os.getenv("MEDIA_CDN_URL", CDN_BASE_URL).strip().rstrip("/")
DEFAULT_IMAGEKIT_CACHEFILE_DIR = "CACHE/images-v2"
IMAGEKIT_CACHEFILE_DIR = (
    os.getenv("IMAGEKIT_CACHEFILE_DIR", DEFAULT_IMAGEKIT_CACHEFILE_DIR).strip().strip("/")
)
if not IMAGEKIT_CACHEFILE_DIR:
    IMAGEKIT_CACHEFILE_DIR = DEFAULT_IMAGEKIT_CACHEFILE_DIR
IMAGEKIT_CACHE_PREFIX = os.getenv("IMAGEKIT_CACHE_PREFIX", IMAGEKIT_CACHEFILE_DIR).strip()
if not IMAGEKIT_CACHE_PREFIX:
    IMAGEKIT_CACHE_PREFIX = IMAGEKIT_CACHEFILE_DIR
IMAGEKIT_LEGACY_CACHEFILE_DIRS = tuple(
    prefix
    for prefix in _parse_csv(os.getenv("IMAGEKIT_LEGACY_CACHEFILE_DIRS", "CACHE/images"))
    if prefix.strip("/")
)
# Keep runtime request paths fast; bucket creation is handled by createbuckets init job.
# Only read by the S3 storage backend.
S3_RUNTIME_BUCKET_AUTOCREATE = _env_bool("S3_RUNTIME_BUCKET_AUTOCREATE", False)

if USE_S3:
    from botocore.config import Config

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
    AWS_S3_CLIENT_CONFIG = Config(
        connect_timeout=max(_env_int("AWS_S3_CONNECT_TIMEOUT", 3), 1),
        read_timeout=max(_env_int("AWS_S3_READ_TIMEOUT", 10), 1),
        retries={
            "max_attempts": max(_env_int("AWS_S3_MAX_RETRIES", 1), 1),
            "mode": "standard",
        },
        max_pool_connections=max(_env_int("AWS_S3_MAX_POOL_CONNECTIONS", 50), 10),
    )

    # ImageKit configuration - store generated thumbnails in MinIO
    IMAGEKIT_DEFAULT_FILE_STORAGE = "root.storage_backends.MediaStorage"
    IMAGEKIT_CACHE_BACKEND = "default"
    IMAGEKIT_DEFAULT_CACHEFILE_STRATEGY = "imagekit.cachefiles.strategies.Optimistic"

    # Static files are always served by whitenoise locally in app containers.
    # A CDN can still be configured to pull from /static and /media.
    STATIC_URL = f"{STATIC_CDN_URL}/static/" if STATIC_CDN_URL else "/static/"
    STATIC_ROOT = BASE_DIR / "static"

    PUBLIC_MEDIA_LOCATION = "media"
    if MEDIA_CDN_URL:
        MEDIA_URL = f"{MEDIA_CDN_URL}/{PUBLIC_MEDIA_LOCATION}/"
    else:
        MEDIA_URL = f"{AWS_S3_URL_PROTOCOL}//{AWS_S3_CUSTOM_DOMAIN}/{PUBLIC_MEDIA_LOCATION}/"
    DEFAULT_FILE_STORAGE = "root.storage_backends.MediaStorage"
else:
    STATIC_URL = f"{STATIC_CDN_URL}/static/" if STATIC_CDN_URL else "/static/"
    STATIC_ROOT = BASE_DIR / "static"

    MEDIA_URL = f"{MEDIA_CDN_URL}/media/" if MEDIA_CDN_URL else "/media/"
    MEDIA_ROOT = BASE_DIR / "media"
    DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"

    # ImageKit configuration for local development
    IMAGEKIT_DEFAULT_FILE_STORAGE = "django.core.files.storage.FileSystemStorage"
    IMAGEKIT_CACHE_BACKEND = "default"
    IMAGEKIT_DEFAULT_CACHEFILE_STRATEGY = "imagekit.cachefiles.strategies.Optimistic"

# Django 5.x uses STORAGES dict for storage backends
STORAGES = {
    "default": {
        "BACKEND": DEFAULT_FILE_STORAGE,
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Don't crash on missing static files in the manifest — serve the unhashed URL instead.
# This prevents 500 errors when a template references a static file not in staticfiles.json.
WHITENOISE_MANIFEST_STRICT = False

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
# FILE UPLOAD VALIDATION SETTINGS
# =============================================================================

MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB
MAX_BANNER_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
MAX_ACTIVE_IMPORT_JOBS_PER_USER = _env_int("MAX_ACTIVE_IMPORT_JOBS_PER_USER", 1)
MAX_IMPORT_JOBS_PER_DAY = _env_int("MAX_IMPORT_JOBS_PER_DAY", 5)
MAX_IMPORT_XML_ENTRIES = _env_int("MAX_IMPORT_XML_ENTRIES", 5000)
MAX_IMPORT_TASK_PAYLOAD_BYTES = _env_int("MAX_IMPORT_TASK_PAYLOAD_BYTES", 512 * 1024)

# =============================================================================
# TEXT FIELD LIMITS
# =============================================================================

MAX_BIO_LENGTH = 5000
MAX_REVIEW_LENGTH = 5000
MAX_COMMENT_LENGTH = 2000

# =============================================================================
# EMAIL SETTINGS (Resend HTTP API)
# =============================================================================

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_API_URL = os.getenv("RESEND_API_URL", "https://api.resend.com")
RESEND_REQUEST_TIMEOUT = _env_float("RESEND_REQUEST_TIMEOUT", 10.0)
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "AniShows <onboarding@resend.dev>")

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
    "DEFAULT_PAGINATION_CLASS": "apps.shared.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "EXCEPTION_HANDLER": "apps.core.api_errors.api_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/minute",
        "user": "150/minute",
        "user_profile_lookup": "90/minute",
        "anime_list": "120/minute",
        "review_access": "60/minute",
        "login": "5/minute",
        "register": "3/hour",
        "password_reset": "3/hour",
        "user_actions": "120/minute",
        "admin_actions": "60/minute",
        "strict_user": "10/minute",
        "social_links": "5/day",
        "forum_like": "30/minute",
        "forum_write": "10/minute",
    },
}

# =============================================================================
# JWT SETTINGS
# =============================================================================

from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "ISSUER": os.getenv("JWT_ISSUER", "anishows.com"),
    "AUDIENCE": os.getenv("JWT_AUDIENCE", "anishows-api"),
    "ALGORITHM": "HS256",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
}

# =============================================================================
# PROFILE CACHE SETTINGS
# =============================================================================

# Cache key prefixes and templates
PROFILE_CACHE_KEY_TEMPLATE = "public_profile:{username}:v{version}"
PROFILE_CACHE_VERSION_KEY_TEMPLATE = "profile_cache_version:{username}"

# Cache TTLs (in seconds)
PROFILE_CACHE_TTL = 1800  # 30 minutes for public profiles
PROFILE_CACHE_VERSION_TTL = 3600  # 1 hour for version keys

# =============================================================================
# REDIS CACHE (with authentication support)
# =============================================================================

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
REDIS_DB = os.getenv("REDIS_DB", "0")
REDIS_CACHE_MAX_CONNECTIONS = _env_int("REDIS_CACHE_MAX_CONNECTIONS", 500)

if REDIS_PASSWORD:
    REDIS_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
    REDIS_BROKER_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/1"
    REDIS_CHANNEL_LAYER_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/2"
else:
    REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")
    REDIS_BROKER_URL = os.getenv("CELERY_BROKER_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/1")
    REDIS_CHANNEL_LAYER_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/2"

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "SOCKET_CONNECT_TIMEOUT": 5,
            "SOCKET_TIMEOUT": 5,
            "RETRY_ON_TIMEOUT": True,
            "CONNECTION_POOL_KWARGS": {"max_connections": REDIS_CACHE_MAX_CONNECTIONS},
            "COMPRESSOR": "django_redis.compressors.zlib.ZlibCompressor",
        },
    }
}

# =============================================================================
# DJANGO CHANNELS (WebSocket support)
# =============================================================================

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_CHANNEL_LAYER_URL],
            "capacity": _env_int("REDIS_CHANNEL_LAYER_CAPACITY", 3000),
            "expiry": _env_int("REDIS_CHANNEL_LAYER_EXPIRY", 15),
            "group_expiry": _env_int("REDIS_CHANNEL_LAYER_GROUP_EXPIRY", 86400),
        },
    },
}

# =============================================================================
# CELERY CONFIGURATION (uses authenticated REDIS_URL)
# =============================================================================

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", REDIS_BROKER_URL)
# No result backend: nothing reads task results through Celery (no
# AsyncResult.get/.state, no chords). Task history lives in core.CeleryTaskResult,
# filled by apps/core/celery_signals.py. With nothing stored there is nothing to
# expire, and RESULT_EXPIRES=None also keeps beat from adding celery.backend_cleanup.
CELERY_RESULT_BACKEND = None
CELERY_RESULT_EXPIRES = None
CELERY_ACCEPT_CONTENT = ["application/json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_BROKER_POOL_LIMIT = _env_int("CELERY_BROKER_POOL_LIMIT", 100)
ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED = True
ANIME_METADATA_AUTO_ENRICH_ENABLED = True
# Multiplier for retry backoff after failed external API calls (0 in tests).
RETRY_BACKOFF_SCALE = 1.0

from .celery_schedule import build_beat_schedule

CELERY_BEAT_SCHEDULE = build_beat_schedule(
    offline_reconcile_batch_size=OFFLINE_RECONCILE_BATCH_SIZE,
    offline_reconcile_chunk_size=OFFLINE_RECONCILE_CHUNK_SIZE,
    offline_reconcile_max_rounds=OFFLINE_RECONCILE_MAX_ROUNDS,
    offline_reconcile_round_interval_minutes=OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES,
    media_self_heal_batch_size=MEDIA_SELF_HEAL_BATCH_SIZE,
)

# =============================================================================
# JAZZMIN SETTINGS
# =============================================================================

from .jazzmin import JAZZMIN_SETTINGS  # noqa: F401 - a setting, read by Django

# =============================================================================
# WEB PUSH NOTIFICATIONS (VAPID)
# =============================================================================

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")

# Generate VAPID keys if not set (for development)
# Run: openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
# Then: openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
