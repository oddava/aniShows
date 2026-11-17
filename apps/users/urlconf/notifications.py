"""Notification routes (G4): feed, preferences, web push, email unsubscribe."""

from django.urls import path

from ..views.notifications import (
    EmailUnsubscribeView,
    NotificationPreferenceView,
    NotificationViewSet,
    PushConfigView,
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
    path(
        "notifications/subscriptions/<int:pk>/",
        PushSubscriptionViewSet.as_view({"delete": "destroy"}),
        name="push_subscription_detail",
    ),
    path("notifications/push/config/", PushConfigView.as_view(), name="push_config"),
    path(
        "notifications/email-unsubscribe/",
        EmailUnsubscribeView.as_view(),
        name="notification_email_unsubscribe",
    ),
]

urlpatterns: list = []
