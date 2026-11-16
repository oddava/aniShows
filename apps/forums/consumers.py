"""WebSocket consumers for the forums app.

Provides real-time updates for forum threads — new posts, edits, removals, likes.
"""

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from ..shared.logger import logger
from .models import Thread

# Close code for an unknown or removed thread (4000-4999 are application codes).
CLOSE_THREAD_NOT_FOUND = 4404


@database_sync_to_async
def _thread_is_visible(thread_id: int) -> bool:
    return Thread.objects.filter(pk=thread_id, is_removed=False).exists()


class ForumThreadConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for live forum thread updates.

    Any user (authenticated or anonymous) can subscribe to a visible thread to
    receive real-time updates. An unknown or removed thread is closed with 4404.

    URL pattern: ``/ws/forums/threads/<thread_id>/``

    Group name: ``forum_thread_{thread_id}``

    Message types sent to client:
        - ``new_post``: A new post/reply was created in the thread
        - ``post_updated``: A post's text changed (edit or restore)
        - ``post_removed``: A post was removed (by its author or a moderator)
        - ``post_liked``: A post in the thread was liked/unliked
        - ``thread_liked``: The thread itself was liked/unliked
    """

    async def connect(self):
        """Join the forum thread group."""
        self.thread_id = self.scope["url_route"]["kwargs"]["thread_id"]
        if not await _thread_is_visible(self.thread_id):
            # Accept first: a close before the handshake can't carry a code.
            await self.accept()
            await self.close(code=CLOSE_THREAD_NOT_FOUND)
            return

        self.group_name = f"forum_thread_{self.thread_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        logger.info(
            "Forum WebSocket connected: thread=%s user=%s",
            self.thread_id,
            getattr(self.scope.get("user"), "id", "anonymous"),
        )

    async def disconnect(self, code):
        """Leave the forum thread group."""
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        """Handle messages from the client.

        Currently the forum consumer is read-only from the client side.
        Clients only receive server-pushed updates. A ping/pong is supported
        for keep-alive.
        """
        if isinstance(content, dict) and content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    # ------------------------------------------------------------------
    # Channel layer event handlers
    # ------------------------------------------------------------------

    async def forum_new_post(self, event):
        """A new post was created in this thread.

        Expected event::

            {
                "type": "forum.new_post",
                "post": { ... serialized post ... },
            }
        """
        await self.send_json(
            {
                "type": "new_post",
                "post": event["post"],
            }
        )

    async def forum_post_updated(self, event):
        """A post's text changed: ``{"type": "forum.post_updated", "post": {id, content, edited_at}}``."""
        await self.send_json({"type": "post_updated", "post": event["post"]})

    async def forum_post_removed(self, event):
        """A post was removed: ``{"type": "forum.post_removed", "post_id": 1, "removal": "author"}``."""
        await self.send_json(
            {"type": "post_removed", "post_id": event["post_id"], "removal": event["removal"]}
        )

    async def forum_post_liked(self, event):
        """A post in this thread was liked or unliked.

        Expected event::

            {
                "type": "forum.post_liked",
                "post_id": 123,
                "like_count": 5,
            }
        """
        await self.send_json(
            {
                "type": "post_liked",
                "post_id": event["post_id"],
                "like_count": event["like_count"],
            }
        )

    async def forum_thread_liked(self, event):
        """The thread itself was liked or unliked.

        Expected event::

            {
                "type": "forum.thread_liked",
                "thread_id": 456,
                "like_count": 10,
            }
        """
        await self.send_json(
            {
                "type": "thread_liked",
                "thread_id": event["thread_id"],
                "like_count": event["like_count"],
            }
        )
