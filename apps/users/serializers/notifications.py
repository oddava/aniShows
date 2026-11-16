"""Notification serializers (G4 Notifications), moved out of the view module."""

from rest_framework.exceptions import ValidationError
from rest_framework.fields import BooleanField, CharField, JSONField
from rest_framework.serializers import ModelSerializer, Serializer

from ...core.models import Notification, PushSubscription
from ...core.services.url_validator import URLValidationError, URLValidator

__all__ = [
    "NotificationPreferencesSerializer",
    "NotificationSerializer",
    "PushSubscriptionSerializer",
]


class NotificationSerializer(ModelSerializer):
    def to_representation(self, instance):
        representation = super().to_representation(instance)
        cover_payload = getattr(instance, "_notification_cover_payload", None)
        if cover_payload:
            data = dict(representation.get("data") or {})
            for key, value in cover_payload.items():
                if value and not data.get(key):
                    data[key] = value
            representation["data"] = data
        return representation

    class Meta:
        model = Notification
        fields = [
            "id",
            "notification_type",
            "title",
            "message",
            "data",
            "is_read",
            "created_at",
            "read_at",
        ]
        read_only_fields = ["id", "created_at", "read_at"]


class PushSubscriptionSerializer(ModelSerializer):
    endpoint = CharField(required=True, max_length=2048)
    p256dh = CharField(required=True)
    auth = CharField(required=True)
    device_type = CharField(default="browser")
    device_info = JSONField(required=False, default=dict)

    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "device_type", "device_info", "created_at"]

    def validate_endpoint(self, value):
        # The worker POSTs to this URL; only public HTTPS push services qualify.
        try:
            URLValidator().validate_public_target(value)
        except URLValidationError as exc:
            raise ValidationError(f"Invalid push endpoint: {exc}") from exc
        # Stored verbatim: unsubscribe matches the browser's endpoint exactly.
        return value


class NotificationPreferencesSerializer(Serializer):
    email_new_episodes = BooleanField()
    push_new_episodes = BooleanField()
    push_review_replies = BooleanField()
    push_new_follower = BooleanField()
