"""Text normalisation shared by the profile serializers and services."""

from __future__ import annotations

import re
from typing import Any

DEFAULT_PROFILE_PRIMARY_COLOR = "#8b5cf6"
HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def decode_escaped_html_entities(value: str) -> str:
    """Undo the HTML escaping that legacy rows stored (``&lt;p&gt;`` back to ``<p>``).

    Only the five entities ``html.escape`` produces are decoded, and ``&amp;`` goes
    last, so ``&amp;lt;`` becomes ``&lt;`` rather than ``<`` (one level per call).
    """
    return (
        value.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&amp;", "&")
    )


def normalize_bio(value: Any) -> Any:
    """Decode a stored bio; anything that is not a string (``None``) passes through."""
    if isinstance(value, str):
        return decode_escaped_html_entities(value)
    return value


def normalize_primary_color(value: Any, default: str = DEFAULT_PROFILE_PRIMARY_COLOR) -> str:
    """Return ``value`` as a lower-case ``#rrggbb`` colour, or ``default`` if it isn't one."""
    if isinstance(value, str):
        candidate = value.strip().lower()
        if HEX_COLOR_PATTERN.match(candidate):
            return candidate
    return default
