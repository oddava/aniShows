"""Small switches the rest of the app uses to cooperate with the catalog engine."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from django.utils import timezone

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

_bulk_write: ContextVar[bool] = ContextVar("catalog_bulk_write", default=False)


@contextmanager
def bulk_catalog_write() -> Iterator[None]:
    """While a lane writes many rows: no per-row AniList follow-ups.

    A new row normally asks for its details and its episode schedule. A sweep
    creating thousands of rows must not turn into thousands of extra requests;
    the details lane and the 6-hourly episode sync pick them up on their own.
    """
    token = _bulk_write.set(True)
    try:
        yield
    finally:
        _bulk_write.reset(token)


def in_bulk_catalog_write() -> bool:
    return _bulk_write.get()


def request_hydrate(anime_ids: Iterable[int]) -> int:
    """Ask the details lane for these rows (no request now). Returns how many were queued."""
    from ..models import Anime

    ids = [anime_id for anime_id in anime_ids if anime_id]
    if not ids:
        return 0
    return Anime.objects.filter(
        id__in=ids, hydrated_at__isnull=True, hydrate_requested_at__isnull=True
    ).update(hydrate_requested_at=timezone.now())
