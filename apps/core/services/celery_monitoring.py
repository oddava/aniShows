"""Helpers for lightweight Celery queue observability."""

from __future__ import annotations

from django.core.cache import cache

from ...animes.services.metrics import update_queue_size

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


def _get_redis_client():
    try:
        return cache.client.get_client()
    except Exception:
        return None


def get_queue_size(queue_name: str) -> int | None:
    client = _get_redis_client()
    if client is None:
        return None

    try:
        return int(client.llen(queue_name))
    except Exception:
        return None


def collect_queue_metrics(queue_names: tuple[str, ...] = DEFAULT_QUEUE_NAMES) -> dict[str, int]:
    sizes: dict[str, int] = {}
    for queue_name in queue_names:
        size = get_queue_size(queue_name)
        if size is None:
            continue
        update_queue_size(queue_name, size)
        sizes[queue_name] = size
    return sizes
