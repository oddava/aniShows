"""Field validators shared by core models."""

import re

from django.core.exceptions import ValidationError
from django.core.validators import URLValidator

_SITE_PATH = re.compile(r"^/(?!/)[^\s\\]*$")
_web_url = URLValidator(schemes=["http", "https"])


def is_site_path(value: str) -> bool:
    """A path on this site ("/schedule"), never a protocol-relative "//host" URL."""
    return bool(_SITE_PATH.match(value or ""))


def validate_site_or_web_link(value: str) -> None:
    """Accept a site path ("/forums") or an http(s) URL; nothing else (no javascript:)."""
    if not value or is_site_path(value):
        return
    try:
        _web_url(value)
    except ValidationError:
        raise ValidationError(
            "Enter a site path such as /schedule, or a full https:// address.", code="invalid"
        ) from None
