"""
Single-use WebSocket tickets.

The SPA trades its access token (sent in the Authorization header) for a
random ticket and puts only that ticket in the WebSocket URL. Access logs then
see a value that is useless after one connection or ``TICKET_TTL_SECONDS``.
"""

import secrets

from django.core.cache import cache

TICKET_TTL_SECONDS = 30
_CACHE_PREFIX = "ws_ticket:"


def issue_ws_ticket(user) -> str:
    ticket = secrets.token_urlsafe(32)
    cache.set(f"{_CACHE_PREFIX}{ticket}", user.pk, timeout=TICKET_TTL_SECONDS)
    return ticket


def consume_ws_ticket(ticket: str | None) -> int | None:
    """Return the ticket's user id and invalidate it; ``None`` if unknown or used."""
    if not ticket:
        return None
    key = f"{_CACHE_PREFIX}{ticket}"
    user_id = cache.get(key)
    # delete() reports whether the key existed, so only one caller wins a race.
    if user_id is None or not cache.delete(key):
        return None
    return user_id
