from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from django.db import connection
from django.db.utils import OperationalError, ProgrammingError

from ..shared.logger import logger

if TYPE_CHECKING:
    from django.db.models import Model

_warned_tables: set[str] = set()


@lru_cache(maxsize=1)
def _table_names() -> set[str]:
    """Return cached table names for the default DB connection."""
    try:
        return set(connection.introspection.table_names())
    except Exception:
        return set()


def invalidate_table_cache() -> None:
    """Invalidate cached table names (useful after migrations)."""
    _table_names.cache_clear()


def model_table_exists(model_cls: type[Model]) -> bool:
    """Return whether the model's DB table currently exists."""
    return model_cls._meta.db_table in _table_names()


def is_missing_relation_error(exc: Exception) -> bool:
    """Return True if exception represents a missing DB relation/table."""
    if not isinstance(exc, (ProgrammingError, OperationalError)):
        return False
    message = str(exc).lower()
    return "does not exist" in message and "relation" in message


def warn_missing_table_once(table_name: str, context: str) -> None:
    """Log a single warning per table to avoid noisy repeated errors."""
    if table_name in _warned_tables:
        return
    _warned_tables.add(table_name)
    logger.warning(
        f"Skipping {context}: table '{table_name}' does not exist yet. "
        "Run migrations (python manage.py migrate)."
    )
