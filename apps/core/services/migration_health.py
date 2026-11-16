"""Whether the database lacks migrations this code expects.

Building the migration graph reads every migration module and the
``django_migrations`` table, which is too costly for a public readiness probe.
With ``max_age`` the answer is reused for that many seconds: in this process,
and (when the image's ``GIT_SHA`` is known) across workers through the cache,
keyed by the commit so replicas of different releases never share an answer.
"""

from __future__ import annotations

import threading
import time

from django.conf import settings
from django.core.cache import cache
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor

from ...shared.logger import logger

_lock = threading.Lock()
# alias -> (monotonic expiry, pending)
_local: dict[str, tuple[float, bool]] = {}
_CACHE_KEY = "health:pending-migrations:{sha}:{alias}"


def _compute(using: str) -> bool:
    connection = connections[using]
    executor = MigrationExecutor(connection)
    return bool(executor.migration_plan(executor.loader.graph.leaf_nodes()))


def _shared_key(using: str) -> str | None:
    sha = getattr(settings, "GIT_SHA", "")
    return _CACHE_KEY.format(sha=sha, alias=using) if sha else None


def has_pending_migrations(using: str = DEFAULT_DB_ALIAS, *, max_age: float = 0) -> bool:
    """True when migrations are unapplied. ``max_age`` > 0 allows a cached answer."""
    if max_age <= 0:
        return _compute(using)

    now = time.monotonic()
    with _lock:
        cached = _local.get(using)
        if cached and cached[0] > now:
            return cached[1]

    key = _shared_key(using)
    pending: bool | None = None
    if key:
        try:
            shared = cache.get(key)
        except Exception:  # noqa: BLE001 - any cache failure: fall back to computing
            logger.warning("Readiness check - migration cache read failed", exc_info=True)
            shared = None
        if isinstance(shared, bool):
            pending = shared

    if pending is None:
        pending = _compute(using)
        if key:
            try:
                cache.set(key, pending, timeout=max(int(max_age), 1))
            except Exception:  # noqa: BLE001 - the answer is still valid without the cache
                logger.warning("Readiness check - migration cache write failed", exc_info=True)

    with _lock:
        _local[using] = (now + max_age, pending)
    return pending


def clear_cached_migration_state() -> None:
    """Forget the in-process answer (tests; after applying migrations in-process)."""
    with _lock:
        _local.clear()
