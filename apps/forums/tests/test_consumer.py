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

    def test_removing_a_thread_closes_guest_connections_but_not_staff(self):
        staff = User.objects.create_user(
            username="mod", email="mod@example.com", password="x", is_staff=True
        )

        async def scenario():
            guest, guest_ok = await _connect(self.thread.pk)
            moderator = WebsocketCommunicator(
                URLRouter(websocket_urlpatterns), f"/ws/forums/threads/{self.thread.pk}/"
            )
            moderator.scope["user"] = staff
            staff_ok, _ = await moderator.connect()
            assert guest_ok and staff_ok
            await get_channel_layer().group_send(
                f"forum_thread_{self.thread.pk}",
                {"type": "forum.thread_removed", "thread_id": self.thread.pk},
            )
            guest_output = await guest.receive_output()
            staff_silent = await moderator.receive_nothing(timeout=0.2)
            await moderator.disconnect()
            return guest_output, staff_silent

        guest_output, staff_silent = async_to_sync(scenario)()
        self.assertEqual(guest_output, {"type": "websocket.close", "code": CLOSE_THREAD_NOT_FOUND})
        self.assertTrue(staff_silent)

    def test_staff_may_follow_a_removed_thread_live(self):
        staff = User.objects.create_user(
            username="mod2", email="mod2@example.com", password="x", is_staff=True
        )
        Thread.objects.filter(pk=self.thread.pk).update(is_removed=True)

        async def scenario():
            communicator = WebsocketCommunicator(
                URLRouter(websocket_urlpatterns), f"/ws/forums/threads/{self.thread.pk}/"
            )
            communicator.scope["user"] = staff
            connected, _ = await communicator.connect()
            silent = await communicator.receive_nothing(timeout=0.2)
            await communicator.disconnect()
            return connected, silent

        connected, silent = async_to_sync(scenario)()
        self.assertTrue(connected and silent)
