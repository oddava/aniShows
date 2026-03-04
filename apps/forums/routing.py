"""WebSocket URL routing for the forums app."""

from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(
        r"ws/forums/threads/(?P<thread_id>\d+)/$",
        consumers.ForumThreadConsumer.as_asgi(),
    ),
]
