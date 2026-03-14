from copy import deepcopy

from django.core.cache import cache
from django.db import DatabaseError
from django.db.utils import OperationalError, ProgrammingError

from apps.core.models import AdminPanelSettings

ADMIN_SETTINGS_CACHE_KEY = "admin:panel_settings:v1"
ADMIN_SETTINGS_DB_KEY = "global"
ADMIN_SETTINGS_CACHE_TTL_SECONDS = 300

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
        "allowComments": True,
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
    if not force_refresh:
        cached = cache.get(ADMIN_SETTINGS_CACHE_KEY)
        if isinstance(cached, dict):
            return deepcopy(cached)

    merged = deepcopy(DEFAULT_ADMIN_SETTINGS)
    try:
        settings_obj = AdminPanelSettings.objects.filter(key=ADMIN_SETTINGS_DB_KEY).first()
        if settings_obj and isinstance(settings_obj.data, dict):
            merged = merge_admin_settings(settings_obj.data)
    except (OperationalError, ProgrammingError, DatabaseError):
        # Fall back to defaults during startup, migrations, or transient DB issues.
        merged = deepcopy(DEFAULT_ADMIN_SETTINGS)

    cache.set(ADMIN_SETTINGS_CACHE_KEY, merged, timeout=ADMIN_SETTINGS_CACHE_TTL_SECONDS)
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


def are_review_comments_enabled() -> bool:
    return bool(get_admin_setting("content", "allowComments", True))
