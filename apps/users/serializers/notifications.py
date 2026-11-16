"""Notification serializers (G4 Notifications), moved out of the view module."""

from rest_framework.exceptions import ValidationError
from rest_framework.fields import BooleanField, CharField, JSONField, SerializerMethodField
from rest_framework.serializers import ModelSerializer, Serializer

from ...core.models import Notification, PushSubscription
from ...core.models.notifications import PUSH_ENDPOINT_MAX_LENGTH
from ...core.services import notification_types
from ...core.services.url_validator import URLValidationError, URLValidator
from ..services.avatar_service import get_user_avatar_url

__all__ = [
    "EmailUnsubscribeSerializer",
    "NotificationSerializer",
    "PushSubscriptionSerializer",
]

DEVICE_LABEL_MAX_LENGTH = 80


class NotificationSerializer(ModelSerializer):
    category = SerializerMethodField()
    url = SerializerMethodField()
    actor = SerializerMethodField()

    def get_category(self, instance) -> str:
        return notification_types.category_for(instance.notification_type)

    def get_url(self, instance) -> str | None:
        return notification_types.url_for(instance)

    def get_actor(self, instance) -> dict | None:
        # Callers select_related("actor__userprofile"); never a query per row.
        actor = instance.actor if instance.actor_id else None
        if actor is None:
            return None
        return {"username": actor.username, "avatar": get_user_avatar_url(actor) or None}

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
            "category",
            "title",
            "message",
            "data",
            "is_read",
            "created_at",
            "read_at",
            "url",
            "actor",
        ]
        read_only_fields = fields


class PushSubscriptionSerializer(ModelSerializer):
    endpoint = CharField(required=True, max_length=PUSH_ENDPOINT_MAX_LENGTH)
    p256dh = CharField(required=True, max_length=255)
    auth = CharField(required=True, max_length=255)
    device_type = CharField(default="browser")
    device_info = JSONField(required=False, default=dict)
    # The app's daily re-sync: only re-activate an existing row, never create one.
    refresh = BooleanField(required=False, default=False)

    class Meta:
        model = PushSubscription
        fields = [
            "id",
            "endpoint",
            "p256dh",
            "auth",
            "device_type",
            "device_info",
            "refresh",
            "created_at",
        ]

    def validate_endpoint(self, value):
        # The worker POSTs to this URL; only public HTTPS push services qualify.
        try:
            URLValidator().validate_public_target(value)
        except URLValidationError as exc:
            raise ValidationError(f"Invalid push endpoint: {exc}") from exc
        # Stored verbatim: unsubscribe matches the browser's endpoint exactly.
        return value

    def validate_device_type(self, value):
        if value not in PushSubscription.DeviceType.values:
            raise ValidationError("Unknown device type.")
        return value

    def validate_device_info(self, value):
        # Only a short display label is kept; arbitrary client JSON is not stored.
        if not isinstance(value, dict):
            raise ValidationError("Expected an object.")
        label = value.get("label")
        if isinstance(label, str) and label.strip():
            return {"label": label.strip()[:DEVICE_LABEL_MAX_LENGTH]}
        return {}


class EmailUnsubscribeSerializer(Serializer):
    token = CharField(max_length=512, trim_whitespace=True)
