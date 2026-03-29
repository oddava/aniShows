from copy import deepcopy
from dataclasses import dataclass

from django.db import transaction

from apps.core.models import AdminPanelSettings
from apps.core.services.admin_settings_service import (
    ADMIN_SETTINGS_DB_KEY,
    DEFAULT_ADMIN_SETTINGS,
    cache_admin_settings,
    get_admin_settings,
    merge_admin_settings,
)

SETTINGS_VALIDATION_RULES = {
    "general": {
        "siteName": {"type": "str", "max_length": 120},
        "siteDescription": {"type": "str", "max_length": 500},
        "maintenanceMode": {"type": "bool"},
        "allowRegistration": {"type": "bool"},
        "defaultLanguage": {"type": "str", "max_length": 10},
        "timezone": {"type": "str", "max_length": 64},
    },
    "users": {
        "emailVerification": {"type": "bool"},
        "allowUsernameChange": {"type": "bool"},
        "minUsernameLength": {"type": "int", "min": 1, "max": 50},
        "maxUsernameLength": {"type": "int", "min": 1, "max": 100},
        "defaultUserRole": {"type": "str", "max_length": 30},
        "profileVisibility": {"type": "str", "max_length": 20},
    },
    "content": {
        "enableReviews": {"type": "bool"},
        "requireApproval": {"type": "bool"},
        "allowComments": {"type": "bool"},
        "autoFetchMetadata": {"type": "bool"},
        "maxUploadSize": {"type": "int", "min": 1, "max": 100},
        "allowedImageTypes": {"type": "str", "max_length": 120},
    },
    "security": {
        "sessionTimeout": {"type": "int", "min": 1, "max": 168},
        "maxLoginAttempts": {"type": "int", "min": 1, "max": 20},
        "requireStrongPassword": {"type": "bool"},
        "twoFactorAuth": {"type": "bool"},
        "ipBlocking": {"type": "bool"},
        "apiRateLimit": {"type": "int", "min": 100, "max": 100000},
    },
}


@dataclass(slots=True)
class AdminSettingsResult:
    payload: dict
    status_code: int


def validate_settings_payload(incoming: dict) -> tuple[dict, dict]:
    merged = deepcopy(DEFAULT_ADMIN_SETTINGS)
    errors = {}

    for section, section_payload in incoming.items():
        if section not in SETTINGS_VALIDATION_RULES:
            errors[section] = "Unknown settings section."
            continue
        if not isinstance(section_payload, dict):
            errors[section] = "Section payload must be an object."
            continue

        section_rules = SETTINGS_VALIDATION_RULES[section]
        for field, value in section_payload.items():
            path = f"{section}.{field}"
            rule = section_rules.get(field)
            if not rule:
                errors[path] = "Unknown setting field."
                continue

            expected_type = rule["type"]
            if expected_type == "bool":
                if not isinstance(value, bool):
                    errors[path] = "Must be a boolean."
                    continue
            elif expected_type == "int":
                if isinstance(value, bool) or not isinstance(value, int):
                    errors[path] = "Must be an integer."
                    continue
                if "min" in rule and value < rule["min"]:
                    errors[path] = f"Must be >= {rule['min']}."
                    continue
                if "max" in rule and value > rule["max"]:
                    errors[path] = f"Must be <= {rule['max']}."
                    continue
            elif expected_type == "str":
                if not isinstance(value, str):
                    errors[path] = "Must be a string."
                    continue
                if not value.strip():
                    errors[path] = "Cannot be blank."
                    continue
                if "max_length" in rule and len(value) > rule["max_length"]:
                    errors[path] = f"Must be <= {rule['max_length']} characters."
                    continue

            merged[section][field] = value

    if merged["users"]["minUsernameLength"] > merged["users"]["maxUsernameLength"]:
        errors["users.minUsernameLength"] = "Cannot be greater than maxUsernameLength."

    return merged, errors


def get_admin_settings_payload(user):
    settings_obj, _ = AdminPanelSettings.objects.get_or_create(
        key=ADMIN_SETTINGS_DB_KEY,
        defaults={"data": deepcopy(DEFAULT_ADMIN_SETTINGS), "updated_by": user},
    )
    merged = merge_admin_settings(settings_obj.data)

    if settings_obj.data != merged:
        settings_obj.data = merged
        settings_obj.save(update_fields=["data", "updated_at"])

    cache_admin_settings(merged)
    return get_admin_settings()


def save_admin_settings_payload(incoming, user) -> AdminSettingsResult:
    if not isinstance(incoming, dict):
        return AdminSettingsResult(
            payload={"detail": "Invalid settings payload."},
            status_code=400,
        )

    merged, errors = validate_settings_payload(incoming)
    if errors:
        return AdminSettingsResult(
            payload={"detail": "Invalid settings payload.", "errors": errors},
            status_code=400,
        )

    with transaction.atomic():
        settings_obj, _ = AdminPanelSettings.objects.select_for_update().get_or_create(
            key=ADMIN_SETTINGS_DB_KEY,
            defaults={"data": deepcopy(DEFAULT_ADMIN_SETTINGS), "updated_by": user},
        )
        settings_obj.data = merged
        settings_obj.updated_by = user
        settings_obj.save(update_fields=["data", "updated_by", "updated_at"])

    cache_admin_settings(merged)
    return AdminSettingsResult(
        payload={"message": "Settings saved successfully.", "settings": merged},
        status_code=200,
    )
