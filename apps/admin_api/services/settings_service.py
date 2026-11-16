from copy import deepcopy
from dataclasses import dataclass

from django.db import transaction

from ...core.models import AdminPanelSettings, AuditLog
from ...core.services.admin_settings_service import (
    ADMIN_SETTINGS_DB_KEY,
    DEFAULT_ADMIN_SETTINGS,
    cache_admin_settings,
    get_admin_settings,
    merge_admin_settings,
)
from .audit import mark_nothing_to_audit, record_admin_action

SETTINGS_VALIDATION_RULES = {
    "general": {
        "maintenanceMode": {"type": "bool"},
        "allowRegistration": {"type": "bool"},
    },
    "users": {
        "emailVerification": {"type": "bool"},
        "allowUsernameChange": {"type": "bool"},
        "minUsernameLength": {"type": "int", "min": 1, "max": 50},
        "maxUsernameLength": {"type": "int", "min": 1, "max": 100},
    },
    "content": {
        "enableReviews": {"type": "bool"},
    },
}


@dataclass(slots=True)
class AdminSettingsResult:
    payload: dict
    status_code: int


def validate_settings_payload(incoming: dict, current: dict | None = None) -> tuple[dict, dict]:
    """Validate a partial nested payload and merge it onto ``current`` (defaults if None)."""
    merged = (
        merge_admin_settings(current) if current is not None else deepcopy(DEFAULT_ADMIN_SETTINGS)
    )
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


def _flatten(settings_data: dict) -> dict:
    return {
        f"{section}.{field}": value
        for section, fields in settings_data.items()
        for field, value in fields.items()
    }


def save_admin_settings_payload(request, incoming) -> AdminSettingsResult:
    """Validate, merge onto the stored settings, save, and audit the old->new diff."""
    if not isinstance(incoming, dict):
        return AdminSettingsResult(
            payload={"detail": "Invalid settings payload."},
            status_code=400,
        )

    user = request.user
    with transaction.atomic():
        settings_obj, _ = AdminPanelSettings.objects.select_for_update().get_or_create(
            key=ADMIN_SETTINGS_DB_KEY,
            defaults={"data": deepcopy(DEFAULT_ADMIN_SETTINGS), "updated_by": user},
        )
        current = merge_admin_settings(settings_obj.data)
        merged, errors = validate_settings_payload(incoming, current)
        if errors:
            return AdminSettingsResult(
                payload={"detail": "Invalid settings payload.", "errors": errors},
                status_code=400,
            )
        settings_obj.data = merged
        settings_obj.updated_by = user
        settings_obj.save(update_fields=["data", "updated_by", "updated_at"])

        before, after = _flatten(current), _flatten(merged)
        changed = sorted(key for key in after if before.get(key) != after[key])
        if changed:
            record_admin_action(
                request,
                action=AuditLog.ActionType.UPDATE,
                entity_type="AdminPanelSettings",
                entity_id=settings_obj.pk,
                entity_repr="Admin settings",
                previous={key: before.get(key) for key in changed},
                new={key: after[key] for key in changed},
            )
        else:
            mark_nothing_to_audit(request)

    cache_admin_settings(merged)
    return AdminSettingsResult(
        payload={"message": "Settings saved successfully.", "settings": merged},
        status_code=200,
    )
