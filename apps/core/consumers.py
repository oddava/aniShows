from apps.shared.logger import logger

"""
WebSocket consumers for the core app.

Provides real-time notification delivery and online presence tracking.
"""

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core.cache import cache
from django.utils import timezone

from apps.core.services.notification_service import NotificationService

ONLINE_TIMEOUT = 300

class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for real-time user notifications and presence.

    Each authenticated user joins a personal notification group:
    ``notifications_user_{user_id}``

    The backend can push notifications to this group via the channel layer
    from anywhere (views, services, Celery tasks).

    Message types sent to client:
        - ``notification``: A new notification was created
        - ``unread_count``: Updated unread notification count
        - ``notification_read``: A notification was marked as read

    Presence:
        On connect, the user is marked online in Redis.
        On disconnect, the online key is removed.
    """

    async def connect(self):
        """Accept connection only for authenticated users."""
        self.user = self.scope.get("user")

        if not self.user or self.user.is_anonymous:
            await self.close(code=4401)
            return

        self.user_id = self.user.id
        self.group_name = f"notifications_user_{self.user_id}"

        # Join personal notification group
        await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.accept()

        # Mark user as online
        await self._set_online()

        # Send current unread count on connect
        unread_count = await self._get_unread_count()
        await self.send_json(
            {
                "type": "unread_count",
                "count": unread_count,
            }
        )

        logger.info("WebSocket connected: user=%s", self.user_id)

    async def disconnect(self, code):
        """Leave notification group and mark user offline."""
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

        if hasattr(self, "user") and self.user and not self.user.is_anonymous:
            await self._set_offline()
            logger.info("WebSocket disconnected: user=%s code=%s", self.user_id, code)

    async def receive_json(self, content, **kwargs):
        """Handle messages from the client.

        Supported client messages:
            - ``{"type": "mark_read", "notification_id": 123}``
            - ``{"type": "mark_all_read"}``
            - ``{"type": "ping"}``
        """
        msg_type = content.get("type")

        if msg_type == "mark_read":
            notification_id = content.get("notification_id")
            if notification_id:
                success = await self._mark_as_read(notification_id)
                if success:
                    unread_count = await self._get_unread_count()
                    await self.send_json(
                        {
                            "type": "notification_read",
                            "notification_id": notification_id,
                            "unread_count": unread_count,
                        }
                    )

        elif msg_type == "mark_all_read":
            await self._mark_all_read()
            await self.send_json(
                {
                    "type": "unread_count",
                    "count": 0,
                }
            )

        elif msg_type == "ping":
            # Heartbeat — refresh online status
            await self._set_online()
            await self.send_json({"type": "pong"})

    # ------------------------------------------------------------------
    # Channel layer event handlers (called when group_send dispatches)
    # ------------------------------------------------------------------

    async def notification_new(self, event):
        """Push a new notification to the client.

        Expected event format from ``channel_layer.group_send``::

            {
                "type": "notification.new",
                "notification": { ... serialized notification ... },
                "unread_count": 5,
            }
        """
        await self.send_json(
            {
                "type": "notification",
                "notification": event["notification"],
                "unread_count": event.get("unread_count"),
            }
        )

    async def notification_updated(self, event):
        """Push an updated notification payload to the client."""
        await self.send_json(
            {
                "type": "notification_updated",
                "notification": event["notification"],
            }
        )

    async def notification_count_update(self, event):
        """Push an updated unread count to the client."""
        await self.send_json(
            {
                "type": "unread_count",
                "count": event["count"],
            }
        )

    # ------------------------------------------------------------------
    # Database helpers
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _get_unread_count(self):
        return NotificationService.get_unread_count_for_user_id(self.user_id)

    @database_sync_to_async
    def _mark_as_read(self, notification_id):
        return NotificationService.mark_as_read(notification_id, self.user)

    @database_sync_to_async
    def _mark_all_read(self):
        NotificationService.mark_all_as_read(self.user)

    # ------------------------------------------------------------------
    # Presence helpers
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _set_online(self):
        from apps.users.services.cache import get_user_online_cache_key

        cache_key = get_user_online_cache_key(self.user_id)
        cache.set(cache_key, timezone.now().isoformat(), timeout=ONLINE_TIMEOUT)

    @database_sync_to_async
    def _set_offline(self):
        from apps.users.services.cache import get_user_online_cache_key

        cache_key = get_user_online_cache_key(self.user_id)
        cache.delete(cache_key)
