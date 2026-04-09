import threading
import time
from copy import deepcopy

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError
from django.db.utils import OperationalError, ProgrammingError

from ..models import AdminPanelSettings

ADMIN_SETTINGS_CACHE_KEY = "admin:panel_settings:v1"
ADMIN_SETTINGS_DB_KEY = "global"
ADMIN_SETTINGS_CACHE_TTL_SECONDS = 300
_LOCAL_SETTINGS_CACHE: dict | None = None
_LOCAL_SETTINGS_CACHE_EXPIRES_AT = 0.0
_LOCAL_SETTINGS_LOCK = threading.Lock()

DEFAULT_ADMIN_SETTINGS = {
    "general": {
        "siteName": "aniShows",
        "siteDescription": "Your Ultimate Anime Discovery Platform",
        "maintenanceMode": False,
        "allowRegistration": True,
        "defaultLanguage": "en",
        "timezone": "UTC",
    },
    "users": {
        "emailVerification": True,
        "allowUsernameChange": True,
        "minUsernameLength": 3,
        "maxUsernameLength": 30,
        "defaultUserRole": "user",
        "profileVisibility": "public",
    },
    "content": {
        "enableReviews": True,
        "requireApproval": False,
        "autoFetchMetadata": True,
        "maxUploadSize": 10,
        "allowedImageTypes": "jpg,jpeg,png,webp",
    },
    "security": {
        "sessionTimeout": 24,
        "maxLoginAttempts": 5,
        "requireStrongPassword": True,
        "twoFactorAuth": False,
        "ipBlocking": False,
        "apiRateLimit": 1000,
    },
}


def _admin_settings_cache_enabled() -> bool:
    return bool(getattr(settings, "ADMIN_SETTINGS_USE_CACHE", True))

def _admin_settings_local_cache_ttl_seconds() -> float:
    raw = getattr(settings, "ADMIN_SETTINGS_LOCAL_CACHE_TTL_SECONDS", 2.0)
    try:
        return max(float(raw), 0.0)
    except (TypeError, ValueError):
        return 2.0

def _get_local_cached_settings() -> dict | None:
    ttl = _admin_settings_local_cache_ttl_seconds()
    if ttl <= 0:
        return None

    now = time.monotonic()
    with _LOCAL_SETTINGS_LOCK:
        global _LOCAL_SETTINGS_CACHE, _LOCAL_SETTINGS_CACHE_EXPIRES_AT
        if _LOCAL_SETTINGS_CACHE is None or now >= _LOCAL_SETTINGS_CACHE_EXPIRES_AT:
            return None
        return deepcopy(_LOCAL_SETTINGS_CACHE)

def _set_local_cached_settings(payload: dict) -> None:
    ttl = _admin_settings_local_cache_ttl_seconds()
    if ttl <= 0:
        return

    with _LOCAL_SETTINGS_LOCK:
        global _LOCAL_SETTINGS_CACHE, _LOCAL_SETTINGS_CACHE_EXPIRES_AT
        _LOCAL_SETTINGS_CACHE = deepcopy(payload)
        _LOCAL_SETTINGS_CACHE_EXPIRES_AT = time.monotonic() + ttl

def _clear_local_cached_settings() -> None:
    with _LOCAL_SETTINGS_LOCK:
        global _LOCAL_SETTINGS_CACHE, _LOCAL_SETTINGS_CACHE_EXPIRES_AT
        _LOCAL_SETTINGS_CACHE = None
        _LOCAL_SETTINGS_CACHE_EXPIRES_AT = 0.0

def cache_admin_settings(payload: dict) -> None:
    """Write merged admin settings to shared cache and local micro-cache."""
    if _admin_settings_cache_enabled():
        cache.set(ADMIN_SETTINGS_CACHE_KEY, payload, timeout=ADMIN_SETTINGS_CACHE_TTL_SECONDS)
        _set_local_cached_settings(payload)
    else:
        _clear_local_cached_settings()

def clear_admin_settings_cache() -> None:
    """Clear both shared and local settings caches."""
    cache.delete(ADMIN_SETTINGS_CACHE_KEY)
    _clear_local_cached_settings()


def merge_admin_settings(payload: dict | None) -> dict:
    merged = deepcopy(DEFAULT_ADMIN_SETTINGS)
    if not isinstance(payload, dict):
        return merged

    for section, fields in payload.items():
        if section not in merged or not isinstance(fields, dict):
            continue
        for field, value in fields.items():
            if field in merged[section]:
                merged[section][field] = value

    return merged


def get_admin_settings(*, force_refresh: bool = False) -> dict:
    use_cache = _admin_settings_cache_enabled()
    if use_cache and not force_refresh:
        local_cached = _get_local_cached_settings()
        if isinstance(local_cached, dict):
            return local_cached

    if use_cache and not force_refresh:
        cached = cache.get(ADMIN_SETTINGS_CACHE_KEY)
        if isinstance(cached, dict):
            _set_local_cached_settings(cached)
            return deepcopy(cached)

    merged = deepcopy(DEFAULT_ADMIN_SETTINGS)
    try:
        settings_obj = AdminPanelSettings.objects.filter(key=ADMIN_SETTINGS_DB_KEY).first()
        if settings_obj and isinstance(settings_obj.data, dict):
            merged = merge_admin_settings(settings_obj.data)
    except (OperationalError, ProgrammingError, DatabaseError):
        # Fall back to defaults during startup, migrations, or transient DB issues.
        merged = deepcopy(DEFAULT_ADMIN_SETTINGS)

    if use_cache:
        cache_admin_settings(merged)
    else:
        _clear_local_cached_settings()
    return deepcopy(merged)


def get_admin_setting(section: str, key: str, default=None):
    settings_data = get_admin_settings()
    return settings_data.get(section, {}).get(key, default)


def is_maintenance_mode_enabled() -> bool:
    return bool(get_admin_setting("general", "maintenanceMode", False))


def is_registration_enabled() -> bool:
    return bool(get_admin_setting("general", "allowRegistration", True))


def is_email_verification_required() -> bool:
    return bool(get_admin_setting("users", "emailVerification", True))


def is_username_change_allowed() -> bool:
    return bool(get_admin_setting("users", "allowUsernameChange", True))


def username_length_limits() -> tuple[int, int]:
    minimum = int(get_admin_setting("users", "minUsernameLength", 3))
    maximum = int(get_admin_setting("users", "maxUsernameLength", 30))
    if minimum > maximum:
        return 3, 30
    return minimum, maximum


def are_reviews_enabled() -> bool:
    return bool(get_admin_setting("content", "enableReviews", True))
