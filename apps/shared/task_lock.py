"""Small cache-backed locks for periodic or expensive tasks."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Iterator

from django.core.cache import cache


@contextmanager
def cache_lock(lock_key: str, *, timeout: int) -> Iterator[bool]:
    """Acquire a best-effort distributed lock backed by the Django cache."""
    token = uuid.uuid4().hex
    acquired = cache.add(lock_key, token, timeout=max(int(timeout), 1))
    try:
        yield acquired
    finally:
        if acquired and cache.get(lock_key) == token:
            cache.delete(lock_key)
