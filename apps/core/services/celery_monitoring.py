"""Helpers for lightweight Celery queue observability.

Queue lengths live in the **broker** (Redis DB 1), not in the cache (DB 0), so they
are read on the broker connection. kombu's Redis transport keeps a queue's
non-default priority levels in sibling lists (the queue name plus a priority suffix); a
queue's size is the sum over all of them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import redis
from django.conf import settings

from ...animes.services.metrics import update_queue_size
from ...shared.errors import CACHE_ERRORS

if TYPE_CHECKING:
    from collections.abc import Iterable

DEFAULT_QUEUE_NAMES = (
    "critical",
    "high_priority",
    "default",
    "batch",
    "images",
    "notifications",
    "analytics",
    "low_priority",
)
# kombu's Redis transport: the separator and the default priority steps.
PRIORITY_SEPARATOR = "\x06\x16"
PRIORITY_STEPS = (0, 3, 6, 9)
BROKER_SOCKET_TIMEOUT_SECONDS = 2.0


def routed_queue_names() -> tuple[str, ...]:
    """The queues Celery is configured with (``task_queues``), minus the dead-letter one."""
    from celery import current_app

    names = tuple(
        queue.name
        for queue in (current_app.conf.task_queues or ())
        if queue.name and queue.name != "dead_letter"
    )
    return names or DEFAULT_QUEUE_NAMES


def _get_redis_client():
    """A Redis client on the broker URL (not the cache), or ``None`` for another broker."""
    url = getattr(settings, "CELERY_BROKER_URL", "") or ""
    if not url.startswith(("redis://", "rediss://", "unix://")):
        return None
    try:
        return redis.Redis.from_url(
            url,
            socket_timeout=BROKER_SOCKET_TIMEOUT_SECONDS,
            socket_connect_timeout=BROKER_SOCKET_TIMEOUT_SECONDS,
        )
    except (ValueError, *CACHE_ERRORS):
        return None


def _priority_keys(queue_name: str) -> list[str]:
    return [
        queue_name if step == 0 else f"{queue_name}{PRIORITY_SEPARATOR}{step}"
        for step in PRIORITY_STEPS
    ]


def get_queue_sizes(queue_names: Iterable[str], client=None) -> dict[str, int] | None:
    """``{queue: pending messages}`` read from the broker, or ``None`` if it is unreachable."""
    client = client if client is not None else _get_redis_client()
    if client is None:
        return None
    sizes: dict[str, int] = {}
    try:
        for name in queue_names:
            sizes[name] = sum(int(client.llen(key)) for key in _priority_keys(name))
    except CACHE_ERRORS:
        return None
    return sizes


def get_queue_size(queue_name: str) -> int | None:
    sizes = get_queue_sizes([queue_name])
    return None if sizes is None else sizes[queue_name]


def collect_queue_metrics(queue_names: tuple[str, ...] = DEFAULT_QUEUE_NAMES) -> dict[str, int]:
    sizes = get_queue_sizes(queue_names) or {}
    for queue_name, size in sizes.items():
        update_queue_size(queue_name, size)
    return sizes
