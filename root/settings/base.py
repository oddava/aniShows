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


def _parse_sentinel_nodes(value: str) -> list[tuple[str, int]]:
    """Parse Redis Sentinel nodes from ``host:port,host:port`` env format."""
    nodes: list[tuple[str, int]] = []
    for node in _parse_csv(value):
        if ":" in node:
            host, port = node.split(":", 1)
            nodes.append((host.strip(), int(port.strip())))
        else:
            nodes.append((node, 26379))
    return nodes

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
JIKAN_BASE_URL = os.getenv("JIKAN_BASE_URL", "http://jikan:8080/v4").strip().rstrip("/")

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

# =============================================================================
# APPLICATION DEFINITION
# =============================================================================

DJANGO_APPS = [
    "daphne",
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
    "django_celery_results",
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
SOCIALACCOUNT_LOGIN_ON_GET = True
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
    "JWT_AUTH_REFRESH_COOKIE": None,
    "SESSION_LOGIN": False,
}

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

# PgBouncer (optional): route app traffic through pooler instead of Postgres directly.
DB_USE_PGBOUNCER = _env_bool("DB_USE_PGBOUNCER", False)
DB_PGBOUNCER_HOST = os.getenv("DB_PGBOUNCER_HOST", "pgbouncer")
DB_PGBOUNCER_PORT = os.getenv("DB_PGBOUNCER_PORT", "6432")

DB_HOST = os.getenv("DB_HOST", "db")
if DB_USE_PGBOUNCER:
    DB_HOST = DB_PGBOUNCER_HOST
    DB_PORT = DB_PGBOUNCER_PORT

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

# PgBouncer transaction pooling is not compatible with server-side cursors.
if DB_USE_PGBOUNCER:
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True

# Read replicas (optional): set DB_REPLICA_HOSTS as comma-separated hosts.
READ_REPLICA_HOSTS = _parse_csv(os.getenv("DB_REPLICA_HOSTS", ""))
READ_REPLICA_ALIASES: list[str] = []

for index, replica_host in enumerate(READ_REPLICA_HOSTS, start=1):
    alias = f"replica{index}"
    READ_REPLICA_ALIASES.append(alias)
    DATABASES[alias] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv(f"DB_REPLICA_{index}_NAME", DB_NAME),
        "USER": os.getenv(f"DB_REPLICA_{index}_USER", DB_USER),
        "PASSWORD": os.getenv(f"DB_REPLICA_{index}_PASSWORD", DB_PASSWORD),
        "HOST": replica_host,
        "PORT": os.getenv(f"DB_REPLICA_{index}_PORT", os.getenv("DB_REPLICA_PORT", "5432")),
        "CONN_MAX_AGE": int(os.getenv("DB_REPLICA_CONN_MAX_AGE", "600")),
        "OPTIONS": {
            "options": "-c default_transaction_read_only=on",
        },
    }

DB_ENABLE_READ_REPLICA_ROUTING = _env_bool("DB_ENABLE_READ_REPLICA_ROUTING", False)
if DB_ENABLE_READ_REPLICA_ROUTING and READ_REPLICA_ALIASES:
    DATABASE_ROUTERS = ["root.db_routers.PrimaryReplicaRouter"]

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
IMAGEKIT_CACHEFILE_DIR = os.getenv(
    "IMAGEKIT_CACHEFILE_DIR", DEFAULT_IMAGEKIT_CACHEFILE_DIR
).strip().strip("/")
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
    # Keep runtime request paths fast; bucket creation is handled by createbuckets init job.
    S3_RUNTIME_BUCKET_AUTOCREATE = _env_bool("S3_RUNTIME_BUCKET_AUTOCREATE", False)

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
    if STATIC_CDN_URL:
        STATIC_URL = f"{STATIC_CDN_URL}/static/"
    else:
        STATIC_URL = "/static/"
    STATIC_ROOT = os.path.join(BASE_DIR, "static")

    PUBLIC_MEDIA_LOCATION = "media"
    if MEDIA_CDN_URL:
        MEDIA_URL = f"{MEDIA_CDN_URL}/{PUBLIC_MEDIA_LOCATION}/"
    else:
        MEDIA_URL = f"{AWS_S3_URL_PROTOCOL}//{AWS_S3_CUSTOM_DOMAIN}/{PUBLIC_MEDIA_LOCATION}/"
    DEFAULT_FILE_STORAGE = "root.storage_backends.MediaStorage"
else:
    if STATIC_CDN_URL:
        STATIC_URL = f"{STATIC_CDN_URL}/static/"
    else:
        STATIC_URL = "/static/"
    STATIC_ROOT = os.path.join(BASE_DIR, "static")

    if MEDIA_CDN_URL:
        MEDIA_URL = f"{MEDIA_CDN_URL}/media/"
    else:
        MEDIA_URL = "/media/"
    MEDIA_ROOT = os.path.join(BASE_DIR, "media")
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
REDIS_SENTINEL_ENABLED = _env_bool("REDIS_SENTINEL_ENABLED", False)
REDIS_SENTINEL_SERVICE_NAME = os.getenv("REDIS_SENTINEL_SERVICE_NAME", "mymaster")
REDIS_SENTINEL_NODES = _parse_sentinel_nodes(
    os.getenv("REDIS_SENTINEL_NODES", "redis-sentinel-1:26379,redis-sentinel-2:26379")
)

if REDIS_SENTINEL_ENABLED:
    sentinel_password_part = f":{REDIS_PASSWORD}@" if REDIS_PASSWORD else ""
    # Use the first sentinel node for URL-based configuration; transport options
    # handle the full sentinel list.
    first_host, first_port = REDIS_SENTINEL_NODES[0]
    REDIS_URL = f"redis://{sentinel_password_part}{first_host}:{first_port}/{REDIS_DB}"
    REDIS_BROKER_URL = f"sentinel://{sentinel_password_part}{first_host}:{first_port}/1"
    REDIS_CHANNEL_LAYER_URL = REDIS_URL

    redis_cache_options = {
        "CLIENT_CLASS": "django_redis.client.SentinelClient",
        "SENTINELS": REDIS_SENTINEL_NODES,
        "SENTINEL_KWARGS": {
            "password": REDIS_PASSWORD,
        },
        "CONNECTION_FACTORY": "django_redis.pool.SentinelConnectionFactory",
        "SENTINEL_MASTER": REDIS_SENTINEL_SERVICE_NAME,
        "SOCKET_CONNECT_TIMEOUT": 5,
        "SOCKET_TIMEOUT": 5,
        "RETRY_ON_TIMEOUT": True,
        "CONNECTION_POOL_KWARGS": {
            "max_connections": REDIS_CACHE_MAX_CONNECTIONS,
        },
        "COMPRESSOR": "django_redis.compressors.zlib.ZlibCompressor",
    }

    channel_layer_hosts = [
        {
            "sentinels": REDIS_SENTINEL_NODES,
            "master_name": REDIS_SENTINEL_SERVICE_NAME,
            "db": 2,
            "password": REDIS_PASSWORD,
        }
    ]
else:
    if REDIS_PASSWORD:
        REDIS_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
        REDIS_BROKER_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/1"
        REDIS_CHANNEL_LAYER_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/2"
    else:
        # Fallback to REDIS_URL env var for backward compatibility.
        REDIS_URL = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")
        REDIS_BROKER_URL = os.getenv("CELERY_BROKER_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/1")
        REDIS_CHANNEL_LAYER_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}/2"

    redis_cache_options = {
        "CLIENT_CLASS": "django_redis.client.DefaultClient",
        "SOCKET_CONNECT_TIMEOUT": 5,
        "SOCKET_TIMEOUT": 5,
        "RETRY_ON_TIMEOUT": True,
        "CONNECTION_POOL_KWARGS": {
            "max_connections": REDIS_CACHE_MAX_CONNECTIONS,
        },
        "COMPRESSOR": "django_redis.compressors.zlib.ZlibCompressor",
    }

    channel_layer_hosts = [REDIS_CHANNEL_LAYER_URL]

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": redis_cache_options,
    }
}

# =============================================================================
# DJANGO CHANNELS (WebSocket support)
# =============================================================================

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": channel_layer_hosts,
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
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "django-db")
if REDIS_SENTINEL_ENABLED:
    CELERY_BROKER_TRANSPORT_OPTIONS = {
        "master_name": REDIS_SENTINEL_SERVICE_NAME,
        "sentinel_kwargs": {"password": REDIS_PASSWORD} if REDIS_PASSWORD else {},
    }
    if CELERY_RESULT_BACKEND != "django-db":
        CELERY_RESULT_BACKEND_TRANSPORT_OPTIONS = {
            "master_name": REDIS_SENTINEL_SERVICE_NAME,
            "sentinel_kwargs": {"password": REDIS_PASSWORD} if REDIS_PASSWORD else {},
        }
CELERY_ACCEPT_CONTENT = ["application/json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_RESULT_EXTENDED = True
CELERY_TIMEZONE = TIME_ZONE
CELERY_BROKER_POOL_LIMIT = _env_int("CELERY_BROKER_POOL_LIMIT", 100)
ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED = True

from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # =========================================================================
    # UNIFIED TASK SCHEDULE
    # =========================================================================
    #
    # Hourly Tasks (staggered refreshes)
    # -------------------------------------------------------------------------
    "sync-trending-hourly": {
        "task": "apps.animes.tasks.sync.sync_anime_catalog",
        "schedule": crontab(minute=5),  # 5 min past hour
        "kwargs": {"sync_type": "trending", "limit": 50},
        "options": {"queue": "high_priority"},
    },
    "derive-airing-hourly": {
        "task": "apps.animes.tasks.sync.sync_anime_catalog",
        "schedule": crontab(minute=30),  # 30 min past hour
        "kwargs": {"sync_type": "airing", "limit": 500},
        "options": {"queue": "high_priority"},
    },
    "sync-airing-schedule-daily": {
        "task": "apps.animes.tasks.airing.sync_airing_workflow",
        "schedule": crontab(hour=1, minute=45),  # Daily before browse/schedule traffic ramps up
        "kwargs": {"phases": ["sync", "cleanup", "backfill"]},
        "options": {"queue": "high_priority"},
    },
    # Daily Tasks (Low-traffic hours: 2 AM - 7 AM)
    # -------------------------------------------------------------------------
    "sync-seasonal-daily": {
        "task": "apps.animes.tasks.sync.sync_anime_catalog",
        "schedule": crontab(hour=2, minute=0),  # 2:00 AM
        "kwargs": {"sync_type": "seasonal", "limit": 100},
        "options": {"queue": "default"},
    },
    "enrich-metadata-daily": {
        "task": "apps.animes.tasks.metadata.enrich_metadata",
        "schedule": crontab(hour=3, minute=0),  # 3:00 AM
        "kwargs": {"mode": "backfill", "batch_size": 100},
        "options": {"queue": "low_priority"},
    },
    "sync-watch-episodes-airing-every-6-hours": {
        "task": "apps.animes.tasks.watch_episodes.sync_watch_episodes_batch",
        "schedule": crontab(hour="*/6", minute=15),
        "kwargs": {"statuses": ["Airing", "Upcoming"], "force": True},
        "options": {"queue": "low_priority"},
    },
    "generate-recommendations-daily": {
        "task": "apps.animes.tasks.recommendations.generate_recommendations",
        "schedule": crontab(hour=5, minute=0),  # 5:00 AM
        "kwargs": {"limit": 10},
        "options": {"queue": "low_priority"},
    },
    "sync-themes-daily": {
        "task": "apps.animes.tasks.themes.sync_theme_songs",
        "schedule": crontab(hour=6, minute=0),  # 6:00 AM
        "kwargs": {"limit": 500},  # Increased from 100 to 500
        "options": {"queue": "high_priority"},
    },
    "sync-themes-retry": {
        "task": "apps.animes.tasks.themes.sync_theme_songs",
        "schedule": crontab(hour=18, minute=0),  # 6:00 PM - retry failed
        "kwargs": {"limit": 200, "retry_failed": True},
        "options": {"queue": "low_priority"},
    },
    "reconcile-offline-catalog-sync-hourly": {
        "task": "apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync",
        "schedule": crontab(minute=45),  # Hourly at :45
        "kwargs": {
            "anime_ids": [],
            "batch_size": OFFLINE_RECONCILE_BATCH_SIZE,
            "chunk_size": OFFLINE_RECONCILE_CHUNK_SIZE,
            "require_themes": True,
            "strict": False,
            "max_rounds": OFFLINE_RECONCILE_MAX_ROUNDS,
            "round_interval_minutes": OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES,
        },
        "options": {"queue": "batch"},
    },
    # YouTube URL Backfill Task - Runs twice daily to catch missed themes
    "backfill-theme-youtube-urls-morning": {
        "task": "apps.animes.tasks.themes.backfill_theme_youtube_urls",
        "schedule": crontab(hour=8, minute=30),  # 8:30 AM
        "kwargs": {"limit": 100},
        "options": {"queue": "low_priority"},
    },
    "backfill-theme-youtube-urls-evening": {
        "task": "apps.animes.tasks.themes.backfill_theme_youtube_urls",
        "schedule": crontab(hour=20, minute=30),  # 8:30 PM
        "kwargs": {"limit": 100},
        "options": {"queue": "low_priority"},
    },
    "user-maintenance-daily": {
        "task": "apps.users.tasks.run_user_maintenance_workflow",
        "schedule": crontab(hour=7, minute=0),  # 7:00 AM
        "kwargs": {
            "cleanup_unverified": True,
            "cleanup_imports": True,
            "unverified_days": 7,
            "import_days": 30,
        },
        "options": {"queue": "low_priority"},
    },
    # Profile/cache maintenance
    "update-user-stats-hourly": {
        "task": "apps.users.tasks.update_all_user_stats",
        "schedule": crontab(minute=10),  # Hourly backstop for missed incremental refreshes
        "options": {"queue": "low_priority"},
    },
    "warm-profile-cache-hourly": {
        "task": "apps.users.tasks.warm_profile_cache",
        "schedule": crontab(minute=0),  # Every hour
        "options": {"queue": "low_priority"},
    },
    "heal-missing-media-30min": {
        "task": "apps.animes.tasks.images.heal_missing_anime_media",
        "schedule": crontab(minute="*/30"),
        "kwargs": {"batch_size": MEDIA_SELF_HEAL_BATCH_SIZE},
        "options": {"queue": "low_priority"},
    },
    "collect-queue-metrics-minute": {
        "task": "apps.core.tasks.cleanup_tasks.collect_queue_metrics",
        "schedule": crontab(minute="*"),
        "options": {"queue": "low_priority"},
    },
    # Weekly Tasks
    # -------------------------------------------------------------------------
    "sync-upcoming-weekly": {
        "task": "apps.animes.tasks.sync.sync_anime_catalog",
        "schedule": crontab(day_of_week=0, hour=3, minute=30),  # Sunday 3:30 AM
        "kwargs": {"sync_type": "next_season", "limit": 100},
        "options": {"queue": "default"},
    },
    # Weekly: refresh a broader airing slice from local Anime fields
    "sync-popular-weekly": {
        "task": "apps.animes.tasks.sync.sync_anime_catalog",
        "schedule": crontab(day_of_week=1, hour=2, minute=0),  # Monday 2:00 AM
        "kwargs": {
            "sync_type": "airing",
            "limit": 500,
        },
        "options": {"queue": "low_priority"},
    },
    # Notification Tasks
    "check-new-episodes": {
        "task": "apps.core.tasks.notifications.check_new_episodes",
        "schedule": crontab(hour="*/6", minute=0),  # Every 6 hours
        "options": {"queue": "default"},
    },
    "send-pending-notifications": {
        "task": "apps.core.tasks.notifications.send_pending_notifications",
        "schedule": crontab(minute="*/10"),  # Every 10 minutes
        "options": {"queue": "default"},
    },
    "cleanup-old-notifications": {
        "task": "apps.core.tasks.notifications.cleanup_old_notifications_task",
        "schedule": crontab(hour=2, minute=30),  # Daily at 2:30 AM
        "kwargs": {"days": 90},
        "options": {"queue": "low_priority"},
    },
    # Maintenance Tasks
    "cleanup-task-results-daily": {
        "task": "apps.core.tasks.cleanup_tasks.cleanup_old_task_results",
        "schedule": crontab(hour=1, minute=0),  # Daily at 1:00 AM
        "kwargs": {"days": 7, "batch_size": 1000},
        "options": {"queue": "low_priority"},
    },
    "celery-backend-cleanup-daily": {
        "task": "celery.backend_cleanup",
        "schedule": crontab(hour=1, minute=30),  # Daily at 1:30 AM
        "options": {"queue": "low_priority"},
    },
    "health-check-workers-hourly": {
        "task": "apps.core.tasks.cleanup_tasks.health_check_workers",
        "schedule": crontab(minute=15),  # Every hour at 15 min past
        "options": {"queue": "low_priority"},
    },
    "update-relation-slugs-daily": {
        "task": "apps.animes.tasks.franchises.update_relation_slugs",
        "schedule": crontab(hour=4, minute=30),  # Daily at 4:30 AM
        "kwargs": {"batch_size": 100},
        "options": {"queue": "low_priority"},
    },
    "flush-forum-view-counts-minute": {
        "task": "apps.core.tasks.cleanup_tasks.flush_forum_view_counts",
        "schedule": crontab(minute="*"),
        "options": {"queue": "low_priority"},
    },
}

# =============================================================================
# JAZZMIN SETTINGS
# =============================================================================

JAZZMIN_SETTINGS = {
    "site_title": "aniShows Admin",
    "site_header": "aniShows",
    "site_brand": "aniShows",
    "site_logo": None,
    "login_logo": None,
    "login_logo_dark": None,
    "site_logo_classes": "img-circle",
    "site_icon": None,
    "welcome_sign": "Welcome to aniShows Administration",
    "copyright": "aniShows",
    "search_model": ["users.CustomUser", "anime.Anime"],
    "user_avatar": None,
    "topmenu_links": [
        {"name": "Dashboard", "url": "admin:index", "permissions": ["auth.view_user"]},
        {"name": "API Admin", "url": "/api/v1/admin/dashboard/", "new_window": True},
        {"app": "users"},
        {"app": "anime"},
        {"app": "core"},
    ],
    "usermenu_links": [
        {"name": "API Admin", "url": "/api/v1/admin/dashboard/", "new_window": True},
        {"model": "users.CustomUser"},
    ],
    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],
    "order_with_respect_to": [
        "auth",
        "users",
        "anime",
        "core",
        "django_celery_beat",
        "django_celery_results",
    ],
    "custom_links": {
        "core": [
            {
                "name": "Celery Dashboard",
                "url": "admin:core_celerytaskresult_changelist",
                "icon": "fas fa-tasks",
                "permissions": ["core.view_celerytaskresult"],
            }
        ]
    },
    "icons": {
        # Auth
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.Group": "fas fa-users",
        # Users app
        "users": "fas fa-users",
        "users.CustomUser": "fas fa-user",
        "users.UserProfile": "fas fa-id-card",
        "users.UserImportJob": "fas fa-file-import",
        "users.UserAnimeList": "fas fa-list",
        "users.UserActivity": "fas fa-chart-line",
        "users.UserFollow": "fas fa-user-friends",
        "users.UserStats": "fas fa-chart-bar",
        "users.SocialLinkChangeLog": "fas fa-link",
        # Anime app
        "animes": "fas fa-film",
        "animes.Anime": "fas fa-tv",
        "animes.Genre": "fas fa-tags",
        "animes.Studio": "fas fa-building",
        "animes.Review": "fas fa-star",
        "animes.Character": "fas fa-user-ninja",
        "animes.Staff": "fas fa-user-tie",
        "animes.AnimeCharacter": "fas fa-people-arrows",
        "animes.AnimeStaff": "fas fa-user-cog",
        "animes.UserFavorite": "fas fa-heart",
        "animes.UserHistory": "fas fa-history",
        "animes.ReviewVote": "fas fa-thumbs-up",
        "animes.ReviewReaction": "fas fa-face-smile",
        "animes.UserRecommendation": "fas fa-magic",
        # Core app
        "core": "fas fa-cog",
        "core.SystemLog": "fas fa-clipboard-list",
        "core.AuditLog": "fas fa-history",
        "core.CeleryTaskResult": "fas fa-tasks",
        "core.CeleryWorkerStatus": "fas fa-server",
        "core.CeleryTaskSchedule": "fas fa-calendar-alt",
        "core.Notification": "fas fa-bell",
        "core.PushSubscription": "fas fa-satellite-dish",
        # Forums app
        "forums": "fas fa-comments",
        "forums.Category": "fas fa-folder",
        "forums.Tag": "fas fa-tag",
        "forums.Thread": "fas fa-comment-dots",
        "forums.Post": "fas fa-reply",
        "forums.ThreadLike": "fas fa-thumbs-up",
        "forums.PostLike": "fas fa-thumbs-up",
        # Celery Beat
        "django_celery_beat": "fas fa-clock",
        "django_celery_beat.PeriodicTask": "fas fa-clock",
        "django_celery_beat.IntervalSchedule": "fas fa-hourglass-half",
        "django_celery_beat.CrontabSchedule": "fas fa-calendar",
        "django_celery_beat.SolarSchedule": "fas fa-sun",
        "django_celery_beat.ClockedSchedule": "fas fa-stopwatch",
        # Celery Results
        "django_celery_results": "fas fa-chart-bar",
        "django_celery_results.TaskResult": "fas fa-check-circle",
        "django_celery_results.GroupResult": "fas fa-layer-group",
    },
    "default_icon_parents": "fas fa-chevron-circle-right",
    "default_icon_children": "fas fa-circle",
    "related_modal_active": False,
    "ui_tweaks": {
        "theme": "darkly",
        "dark_mode_theme": "darkly",
        "navbar": "navbar-dark",
        "navbar_fixed": False,
        "footer_fixed": False,
        "sidebar_fixed": True,
        "sidebar": "sidebar-dark-primary",
        "sidebar_nav_small_text": False,
        "sidebar_disable_expand": False,
        "sidebar_nav_child_indent": True,
        "sidebar_nav_compact_style": False,
        "sidebar_nav_legacy_style": False,
        "sidebar_nav_flat_style": False,
    },
    "custom_css": None,
    "custom_js": None,
    "use_google_fonts_cdn": True,
    "show_ui_builder": True,
    "changeform_format": "horizontal_tabs",
    "changeform_format_overrides": {
        "auth.user": "collapsible",
        "auth.group": "vertical_tabs",
        "users.CustomUser": "collapsible",
        "anime.Anime": "horizontal_tabs",
    },
    "language_chooser": False,
}

# =============================================================================
# WEB PUSH NOTIFICATIONS (VAPID)
# =============================================================================

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")

# Generate VAPID keys if not set (for development)
# Run: openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
# Then: openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
