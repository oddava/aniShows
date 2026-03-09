"""WebSocket URL routing for the forums app."""

from django.urls import path

from . import consumers

websocket_urlpatterns = [
    path("ws/forums/threads/<int:thread_id>/", consumers.ForumThreadConsumer.as_asgi()),
]
