"""Badge serializers (G5 Community)."""

from rest_framework.serializers import (
    ModelSerializer,
)

from ..models import Badge, UserBadge

__all__ = [
    "BadgeSerializer",
    "UserBadgeSerializer",
]


class BadgeSerializer(ModelSerializer):
    """Serializer for a badge definition."""

    class Meta:
        model = Badge
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "icon",
            "image",
            "color",
            "priority",
            "is_active",
        ]
        read_only_fields = ["slug"]


class UserBadgeSerializer(ModelSerializer):
    """Serializer for a badge held by a user."""

    badge = BadgeSerializer(read_only=True)

    class Meta:
        model = UserBadge
        fields = [
            "id",
            "badge",
            "granted_at",
            "is_featured",
        ]
