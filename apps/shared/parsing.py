"""Lenient parsing of loosely typed values (provider payloads, query params, JSON)."""

from __future__ import annotations

from typing import Any


def positive_int(value: Any, *, allow_bool: bool = True) -> int | None:
    """Return ``int(value)`` when it is a positive integer, else ``None``.

    Anything ``int()`` accepts is tried (``"7"``, ``7.9`` -> 7). ``bool`` is an
    ``int`` subclass, so ``True`` becomes 1 unless ``allow_bool`` is False; pass
    that for client-supplied JSON, where ``true`` is never a valid ID.
    """
    if not allow_bool and isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None
