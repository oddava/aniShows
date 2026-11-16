"""Notification preferences: ``{category: {channel: bool}}`` per user.

A missing ``NotificationPreference`` row means defaults. On read, unknown keys are
dropped, defaults are merged in and locked channels are forced on, so callers always
get a complete, valid matrix.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import transaction

from ..models import NotificationPreference
from .notification_types import ACCOUNT, CATEGORY_KEYS, EPISODES, FOLLOWS, LIKES, REPLIES

IN_APP = "in_app"
PUSH = "push"
EMAIL = "email"

CHANNEL_LABELS = {IN_APP: "In-app", PUSH: "Push", EMAIL: "Email"}

Preferences = dict[str, dict[str, bool]]


class PreferenceError(ValueError):
    """A preference update names an unknown category/channel or flips a locked toggle."""


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    description: str
    channels: tuple[str, ...]
    locked: tuple[str, ...] = ()


CATEGORIES: dict[str, Category] = {
    c.key: c
    for c in (
        Category(EPISODES, "Episodes", "", (IN_APP, PUSH, EMAIL)),
        Category(REPLIES, "Replies", "Replies to you and mentions in the forums", (IN_APP, PUSH)),
        Category(LIKES, "Likes", "Likes on your reviews, threads and posts", (IN_APP, PUSH)),
        Category(FOLLOWS, "Follows", "New followers", (IN_APP, PUSH)),
        Category(ACCOUNT, "Account", "Badges and announcements", (IN_APP, PUSH), (IN_APP,)),
    )
}
assert tuple(CATEGORIES) == CATEGORY_KEYS


def defaults() -> Preferences:
    """Defaults for a user without a saved row (read at call time: D-4 is a setting)."""
    return {
        EPISODES: {
            IN_APP: True,
            PUSH: True,
            EMAIL: bool(getattr(settings, "NEW_USER_EMAIL_EPISODES", True)),
        },
        REPLIES: {IN_APP: True, PUSH: True},
        LIKES: {IN_APP: True, PUSH: False},
        FOLLOWS: {IN_APP: True, PUSH: True},
        ACCOUNT: {IN_APP: True, PUSH: True},
    }


def normalize(raw: Any) -> Preferences:
    """A complete matrix from stored JSON: unknown keys dropped, defaults merged."""
    result = defaults()
    stored = raw if isinstance(raw, Mapping) else {}
    for key, category in CATEGORIES.items():
        values = stored.get(key)
        if not isinstance(values, Mapping):
            continue
        for channel in category.channels:
            if channel in category.locked:
                continue
            value = values.get(channel)
            if isinstance(value, bool):
                result[key][channel] = value
    return result


def _description(category: Category) -> str:
    if category.key != EPISODES:
        return category.description
    # Follows the D-4 setting, so the copy never promises less or more than is sent.
    plan_to_watch = getattr(settings, "PLAN_TO_WATCH_ALERTS", "all")
    if plan_to_watch == "all":
        return "New episodes of shows in your Watching and Plan to Watch lists"
    if plan_to_watch == "premiere":
        return "New episodes of shows you're watching, and premieres of shows you plan to watch"
    return "New episodes of shows in your Watching list"


def schema() -> dict[str, Any]:
    return {
        "channels": [{"key": key, "label": label} for key, label in CHANNEL_LABELS.items()],
        "categories": [
            {
                "key": c.key,
                "label": c.label,
                "description": _description(c),
                "channels": list(c.channels),
                "locked": list(c.locked),
            }
            for c in CATEGORIES.values()
        ],
    }


def wants(preferences: Preferences, category: str, channel: str) -> bool:
    return bool(preferences.get(category, {}).get(channel, False))


def get_preferences(user_id: int) -> Preferences:
    raw = (
        NotificationPreference.objects.filter(user_id=user_id)
        .values_list("preferences", flat=True)
        .first()
    )
    return normalize(raw)


def preferences_for(user_ids: Iterable[int]) -> dict[int, Preferences]:
    """Preferences for many users in one query; users without a row get defaults."""
    ids = list(dict.fromkeys(user_ids))
    stored: dict[int, Any] = (
        dict(
            NotificationPreference.objects.filter(user_id__in=ids).values_list(
                "user_id", "preferences"
            )
        )
        if ids
        else {}
    )
    return {user_id: normalize(stored.get(user_id)) for user_id in ids}


def apply_update(current: Preferences, update: Any, *, replace: bool = False) -> Preferences:
    """Validate ``update`` (a nested partial object) and apply it to ``current``.

    ``replace=True`` starts from defaults instead of ``current`` (HTTP PUT).
    Raises ``PreferenceError`` on an unknown category/channel, a non-boolean value or
    an attempt to turn a locked channel off.
    """
    if not isinstance(update, Mapping):
        raise PreferenceError("Expected an object of {category: {channel: boolean}}.")
    result = defaults() if replace else {k: dict(v) for k, v in current.items()}
    for key, values in update.items():
        category = CATEGORIES.get(key)
        if category is None:
            raise PreferenceError(f"Unknown notification category: {key}.")
        if not isinstance(values, Mapping):
            raise PreferenceError(f"Expected an object of channels for {key}.")
        for channel, value in values.items():
            if channel not in category.channels:
                raise PreferenceError(f"Unknown channel {channel} for {key}.")
            if not isinstance(value, bool):
                raise PreferenceError(f"{key}.{channel} must be true or false.")
            if channel in category.locked:
                if value != result[key][channel]:
                    raise PreferenceError(f"{key}.{channel} cannot be changed.")
                continue
            result[key][channel] = value
    return result


def update_preferences(user_id: int, update: Any, *, replace: bool = False) -> Preferences:
    """Apply ``update`` under a row lock, so concurrent toggles never lose each other."""
    with transaction.atomic():
        row, _created = NotificationPreference.objects.get_or_create(
            user_id=user_id, defaults={"preferences": {}}
        )
        row = NotificationPreference.objects.select_for_update().get(pk=row.pk)
        result = apply_update(normalize(row.preferences), update, replace=replace)
        row.preferences = result
        row.save(update_fields=["preferences", "updated_at"])
    return result


def disable_channel(user_id: int, category: str, channel: str) -> Preferences:
    """Turn one channel off (email unsubscribe); a no-op write if it is already off."""
    return update_preferences(user_id, {category: {channel: False}})
