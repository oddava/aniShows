"""Media URL helpers for admin payloads."""

from __future__ import annotations

from django.core.files.storage import default_storage


def poster_url(image_name: str | None, external_url: str | None) -> str:
    """A displayable poster: the stored file's URL, else the external one (A26)."""
    if image_name:
        try:
            return default_storage.url(image_name)
        except (ValueError, NotImplementedError):
            pass
    return external_url or ""
