"""Notification routes (G4): feed, preferences, web-push subscriptions."""

from django.urls import path

from ..views.notifications import (
    NotificationPreferenceView,
    NotificationViewSet,
    PushSubscriptionViewSet,
)

router_routes = [
    (r"notifications", NotificationViewSet, "notifications"),
]

# Before the router: its notifications/{pk}/ detail route would match these.
priority_urlpatterns = [
    path(
        "notifications/preferences/",
        NotificationPreferenceView.as_view(),
        name="notification_preferences",
    ),
    path(
        "notifications/subscribe/",
        PushSubscriptionViewSet.as_view({"post": "create", "get": "list", "delete": "unsubscribe"}),
        name="push_subscribe",
    ),
    path(
        "notifications/unsubscribe/",
        PushSubscriptionViewSet.as_view({"delete": "unsubscribe"}),
        name="push_unsubscribe",
    ),
]

urlpatterns: list = []
