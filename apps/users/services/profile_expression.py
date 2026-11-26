"""The profile's self-expression fields: display name, pronouns, location,
a custom status, and which overview sections the owner shows.

One place reads them off a ``UserProfile`` (every profile payload uses it) and
one place cleans user input for them, so the own-profile payload, the public
payload and the serializer fallback can never drift apart.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from rest_framework.exceptions import ValidationError

__all__ = [
    "EXPRESSION_FIELDS",
    "SECTIONS",
    "TEXT_LIMITS",
    "clean_expression_text",
    "clean_hidden_sections",
    "clean_status_emoji",
    "expression_payload",
    "normalize_expression_payload",
]

# Field -> max length (characters), matching the model columns.
TEXT_LIMITS = {
    "display_name": 40,
    "pronouns": 30,
    "location": 40,
    "status_text": 80,
}
TEXT_FIELDS = (*TEXT_LIMITS, "status_emoji")
EXPRESSION_FIELDS = (*TEXT_FIELDS, "hidden_sections")
# Overview sections an owner may hide.
SECTIONS = (
    "now_watching",
    "stats",
    "watching",
    "favorites",
    "characters",
    "staff",
    "taste",
    "activity",
)

# Zero-width joiner and variation selector 16: emoji sequences need them.
_EMOJI_JOINERS = (chr(0x200D), chr(0xFE0F))
_WHITESPACE = re.compile(r"\s+")
# Letters, digits and ASCII punctuation are text, not an emoji.
_NOT_EMOJI = re.compile(r"[0-9A-Za-z\s<>&\"'`=/\\]")


def _strip_controls(value: str) -> str:
    # Fold whitespace (newlines too) to single spaces, then drop control and
    # format characters except ZWJ (U+200D) and VS16 (U+FE0F), which emoji
    # sequences need.
    kept = "".join(
        ch
        for ch in _WHITESPACE.sub(" ", value)
        if ch in _EMOJI_JOINERS or unicodedata.category(ch) not in ("Cc", "Cf", "Co", "Cs")
    )
    return _WHITESPACE.sub(" ", kept).strip()


def clean_expression_text(field: str, value: Any) -> str:
    """One line of plain text, trimmed; blank clears the field."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValidationError("Must be text.")
    cleaned = _strip_controls(value)
    limit = TEXT_LIMITS[field]
    if len(cleaned) > limit:
        raise ValidationError(f"Keep it to {limit} characters or fewer.")
    return cleaned


def clean_status_emoji(value: Any) -> str:
    """A single emoji (a short sequence of symbols), or blank."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValidationError("Must be text.")
    cleaned = value.strip()
    if not cleaned:
        return ""
    if len(cleaned) > 16 or _NOT_EMOJI.search(cleaned):
        raise ValidationError("Pick one emoji.")
    if any(unicodedata.category(ch) in ("Cc", "Co", "Cs") for ch in cleaned):
        raise ValidationError("Pick one emoji.")
    return cleaned


def clean_hidden_sections(value: Any) -> list[str]:
    """A list of known section keys, deduplicated, in ``SECTIONS`` order.

    Accepts a list or its JSON text (multipart form posts send strings).
    """
    if value in (None, ""):
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValidationError("Must be a list of section names.") from exc
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValidationError("Must be a list of section names.")
    unknown = sorted(set(value) - set(SECTIONS))
    if unknown:
        raise ValidationError(f"Unknown sections: {', '.join(unknown)}.")
    return [section for section in SECTIONS if section in value]


def expression_payload(profile) -> dict:
    """The expression fields of ``profile`` (``None`` reads as all blank)."""
    data = {field: (getattr(profile, field, "") or "") if profile else "" for field in TEXT_FIELDS}
    hidden = getattr(profile, "hidden_sections", None) if profile else None
    data["hidden_sections"] = [section for section in SECTIONS if section in (hidden or [])]
    return data


def normalize_expression_payload(data: dict) -> dict:
    """Fill in blanks for payloads cached before these fields existed."""
    for field in TEXT_FIELDS:
        value = data.get(field)
        data[field] = value if isinstance(value, str) else ""
    hidden = data.get("hidden_sections")
    data["hidden_sections"] = [s for s in SECTIONS if isinstance(hidden, list) and s in hidden]
    return data
