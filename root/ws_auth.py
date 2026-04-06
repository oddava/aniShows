"""
JWT authentication middleware for Django Channels WebSocket connections.

Authenticates WebSocket connections using a JWT access token passed as a
query parameter: ws://host/ws/path/?token=<jwt_access_token>

On successful auth, ``scope["user"]`` is set to the authenticated Django user.
On failure, ``scope["user"]`` is set to ``AnonymousUser``.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.shared.logger import logger

User = get_user_model()


@database_sync_to_async
def get_user_from_token(token_str):
    """Validate a JWT access token and return the corresponding user.

    Args:
        token_str: Raw JWT access token string.

    Returns:
        User instance if valid, AnonymousUser otherwise.
    """
    try:
        token = AccessToken(token_str)
        user_id = token["user_id"]
        return User.objects.get(id=user_id)
    except (InvalidToken, TokenError) as exc:
        logger.debug("WebSocket JWT auth failed: %s", exc)
        return AnonymousUser()
    except User.DoesNotExist:
        logger.warning("WebSocket JWT token references non-existent user_id")
        return AnonymousUser()
    except Exception:
        logger.exception("Unexpected error during WebSocket JWT auth")
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Channels middleware that authenticates via JWT query parameter.

    Usage in ASGI routing::

        application = ProtocolTypeRouter({
            "websocket": JWTAuthMiddleware(
                URLRouter(websocket_urlpatterns),
            ),
        })

    The frontend connects with::

        new WebSocket("ws://host/ws/notifications/?token=<access_token>")
    """

    async def __call__(self, scope, receive, send):
        """Extract token from query string and authenticate."""
        query_string = scope.get("query_string", b"").decode("utf-8")
        query_params = parse_qs(query_string)
        token_list = query_params.get("token", [])

        if token_list:
            scope["user"] = await get_user_from_token(token_list[0])
        else:
            scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)
