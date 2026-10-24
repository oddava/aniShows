from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from ..consumers import NotificationConsumer
from ..models import Notification

User = get_user_model()


class NotificationConsumerTests(TransactionTestCase):
    def test_malformed_messages_are_ignored_and_the_socket_stays_open(self):
        user = User.objects.create_user(username="ws", email="ws@example.com", password="x")
        notification = Notification.objects.create(
            user=user,
            notification_type=Notification.NotificationType.NEW_FOLLOWER,
            title="t",
            message="m",
        )

        async def scenario():
            communicator = WebsocketCommunicator(NotificationConsumer.as_asgi(), "/ws/notifications/")
            communicator.scope["user"] = user
            connected, _ = await communicator.connect()
            assert connected
            assert (await communicator.receive_json_from())["type"] == "unread_count"

            for bad in (
                {"type": "mark_read", "notification_id": "abc"},
                {"type": "mark_read", "notification_id": True},
                {"type": "mark_read", "notification_id": [1]},
                ["not", "an", "object"],
            ):
                await communicator.send_json_to(bad)

            await communicator.send_json_to({"type": "mark_read", "notification_id": notification.id})
            reply = await communicator.receive_json_from()
            await communicator.disconnect()
            return reply

        reply = async_to_sync(scenario)()

        self.assertEqual(reply["type"], "notification_read")
        self.assertEqual(reply["unread_count"], 0)
