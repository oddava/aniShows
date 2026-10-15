"""
Ticket authentication middleware for Django Channels WebSocket connections.

The SPA first calls ``POST /api/v1/auth/ws-ticket/`` with its access token and
then connects with the single-use ticket it gets back:
``ws://host/ws/path/?ticket=<ticket>``. The JWT itself never appears in a URL,
so it cannot leak through proxy access logs.

On success ``scope["user"]`` is the ticket's user; otherwise ``AnonymousUser``.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser

from apps.shared.logger import logger
from apps.users.services.ws_ticket_service import consume_ws_ticket

User = get_user_model()


def user_for_ticket(ticket):
    """Consume a WebSocket ticket and return its user, or ``AnonymousUser``."""
    try:
        user_id = consume_ws_ticket(ticket)
        if user_id is None:
            logger.debug("WebSocket ticket unknown, expired or already used")
            return AnonymousUser()
        return User.objects.get(id=user_id, is_active=True)
    except User.DoesNotExist:
        logger.warning("WebSocket ticket references a missing or inactive user")
        return AnonymousUser()
    except Exception:
        logger.exception("Unexpected error during WebSocket ticket auth")
        return AnonymousUser()


get_user_from_ticket = database_sync_to_async(user_for_ticket)


class WSTicketAuthMiddleware(BaseMiddleware):
    """Channels middleware that authenticates via a ``ticket`` query parameter."""

    async def __call__(self, scope, receive, send):
        query_params = parse_qs(scope.get("query_string", b"").decode("utf-8"))
        ticket = (query_params.get("ticket") or [None])[0]

        scope["user"] = await get_user_from_ticket(ticket) if ticket else AnonymousUser()
        return await super().__call__(scope, receive, send)
