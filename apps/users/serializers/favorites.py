"""Favorite serializers (G5 Community)."""

from rest_framework.exceptions import ValidationError
from rest_framework.serializers import (
    IntegerField,
    ListField,
    ModelSerializer,
    Serializer,
)

from ...animes.models import (
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
    "AnimeFavoriteToggleSerializer",
    "CharacterFavoriteSerializer",
    "CharacterFavoriteToggleSerializer",
    "FavoriteCompactSerializer",
    "FavoriteReorderSerializer",
    "FavoriteSerializer",
    "StaffFavoriteSerializer",
    "StaffFavoriteToggleSerializer",
]

# Primary keys are BigAutoField; anything larger would fail in the database.
MAX_OBJECT_ID = 2**63 - 1
MAX_REORDER_IDS = 500


class FavoriteSerializer(ModelSerializer):
    anime = AnimeListSerializer(read_only=True)

    class Meta:
        model = UserFavorite
        fields = ["id", "anime", "added_at"]
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


def _object_id_field() -> IntegerField:
    return IntegerField(min_value=1, max_value=MAX_OBJECT_ID)


class AnimeFavoriteToggleSerializer(Serializer):
    anime_id = _object_id_field()


class CharacterFavoriteToggleSerializer(Serializer):
    character_id = _object_id_field()


class StaffFavoriteToggleSerializer(Serializer):
    staff_id = _object_id_field()


class _LegacyReorderItemSerializer(Serializer):
    id = _object_id_field()
    order = IntegerField(required=False, default=0)


class FavoriteReorderSerializer(Serializer):
    """``{"ids": [favorite_id, ...]}`` in display order.

    The legacy ``{"items": [{"id", "order"}]}`` payload is still accepted for one
    release; it is read as the ids sorted by ``order``. Validated data is ``{"ids"}``.
    """

    ids = ListField(
        child=_object_id_field(),
        required=False,
        allow_empty=False,
        max_length=MAX_REORDER_IDS,
    )
    items = _LegacyReorderItemSerializer(
        many=True,
        required=False,
        allow_empty=False,
        max_length=MAX_REORDER_IDS,
    )

    def validate(self, attrs):
        if "ids" in attrs:
            ids = attrs["ids"]
        elif "items" in attrs:
            ids = [item["id"] for item in sorted(attrs["items"], key=lambda item: item["order"])]
        else:
            raise ValidationError({"ids": "This field is required."})
        if len(set(ids)) != len(ids):
            raise ValidationError({"ids": "Favorite ids must be unique."})
        return {"ids": ids}
