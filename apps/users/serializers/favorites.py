"""Favorite serializers (G5 Community)."""

from rest_framework.serializers import (
    ModelSerializer,
    PrimaryKeyRelatedField,
)

from ...animes.models import (
    Anime,
    UserFavorite,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)
from ...animes.serializers.anime import (
    AnimeCompactSerializer,
    AnimeListSerializer,
)
from ...animes.serializers.base import (
    CharacterCompactSerializer,
    StaffCompactSerializer,
)

__all__ = [
    "CharacterFavoriteSerializer",
    "FavoriteCompactSerializer",
    "FavoriteSerializer",
    "StaffFavoriteSerializer",
]


class FavoriteSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)
    anime_id = PrimaryKeyRelatedField(queryset=Anime.objects.all(), source="anime", write_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "anime_id", "added_at"]
        read_only_fields = ["id", "added_at"]


class CharacterFavoriteSerializer(ModelSerializer):
    character = CharacterCompactSerializer(read_only=True)

    class Meta:
        model = UserFavoriteCharacter
        fields = ["id", "character", "added_at"]
        read_only_fields = ["id", "added_at"]


class StaffFavoriteSerializer(ModelSerializer):
    staff = StaffCompactSerializer(read_only=True)

    class Meta:
        model = UserFavoriteStaff
        fields = ["id", "staff", "added_at"]
        read_only_fields = ["id", "added_at"]


class FavoriteCompactSerializer(ModelSerializer):
    """Ultra-minimal serializer for favorites list display."""

    anime = AnimeCompactSerializer(read_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "added_at"]
        read_only_fields = ["id", "added_at"]
