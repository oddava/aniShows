"""Personal recommendation serializer (G2 Browse & discover)."""

from rest_framework.serializers import (
    CharField,
    ModelSerializer,
)

from ...animes.serializers.anime import (
    AnimeListSerializer,
)

__all__ = [
    "UserRecommendationSerializer",
]


class UserRecommendationSerializer(ModelSerializer):
    """Serializer for user recommendations with anime details and reason"""

    anime = AnimeListSerializer(read_only=True)
    reason_text = CharField(source="get_reason_display_text", read_only=True)

    class Meta:
        from ...animes.models import UserRecommendation

        model = UserRecommendation
        fields = [
            "id",
            "anime",
            "score",
            "reason",
            "reason_text",
            "reason_metadata",
            "created_at",
        ]
        read_only_fields = fields
