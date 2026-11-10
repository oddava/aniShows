"""Old import path for the shared provider base; it now lives in ``providers.base``."""

from .providers.base import (
    CLEARABLE_FIELDS,
    CREATE_DEFAULTS,
    UNIQUE_ANIME_FIELDS,
    UNKNOWN_IF_ZERO,
    CatalogProviderBase,
    merge_for_update,
    with_creation_defaults,
)

__all__ = [
    "CLEARABLE_FIELDS",
    "CREATE_DEFAULTS",
    "UNIQUE_ANIME_FIELDS",
    "UNKNOWN_IF_ZERO",
    "CatalogProviderBase",
    "merge_for_update",
    "with_creation_defaults",
]
