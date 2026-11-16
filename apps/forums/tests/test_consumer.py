"""Forum thread WebSocket: unknown/removed threads are refused, edits and removals are pushed (P2-3)."""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from ..consumers import CLOSE_THREAD_NOT_FOUND
from ..models import Category, Post, Thread
from ..routing import websocket_urlpatterns

User = get_user_model()


async def _connect(thread_id):
    communicator = WebsocketCommunicator(
        URLRouter(websocket_urlpatterns), f"/ws/forums/threads/{thread_id}/"
    )
    connected, _ = await communicator.connect()
    return communicator, connected


class ForumThreadConsumerTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="ws", email="ws@example.com", password="x")
        category = Category.objects.create(name="C", slug="c")
        self.thread = Thread.objects.create(
            category=category, author=self.user, title="T", content="c"
        )

    def _close_code_for(self, thread_id):
        async def scenario():
            communicator, connected = await _connect(thread_id)
            assert connected
            output = await communicator.receive_output()
            await communicator.disconnect()
            return output

        output = async_to_sync(scenario)()
        self.assertEqual(output["type"], "websocket.close")
        return output["code"]

    def test_unknown_and_removed_threads_are_closed_with_4404(self):
        self.assertEqual(self._close_code_for(999999), CLOSE_THREAD_NOT_FOUND)
        Thread.objects.filter(pk=self.thread.pk).update(is_removed=True)
        self.assertEqual(self._close_code_for(self.thread.pk), CLOSE_THREAD_NOT_FOUND)

    def test_post_updates_and_removals_are_pushed(self):
        post = Post.objects.create(thread=self.thread, author=self.user, content="p")

        async def scenario():
            communicator, connected = await _connect(self.thread.pk)
            assert connected
            await get_channel_layer().group_send(
                f"forum_thread_{self.thread.pk}",
                {
                    "type": "forum.post_updated",
                    "post": {"id": post.id, "content": "new", "edited_at": None},
                },
            )
            updated = await communicator.receive_json_from()
            await get_channel_layer().group_send(
                f"forum_thread_{self.thread.pk}",
                {"type": "forum.post_removed", "post_id": post.id, "removal": "moderator"},
            )
            removed = await communicator.receive_json_from()
            await communicator.disconnect()
            return updated, removed

        updated, removed = async_to_sync(scenario)()
        self.assertEqual(
            updated,
            {"type": "post_updated", "post": {"id": post.id, "content": "new", "edited_at": None}},
        )
        self.assertEqual(
            removed, {"type": "post_removed", "post_id": post.id, "removal": "moderator"}
        )
