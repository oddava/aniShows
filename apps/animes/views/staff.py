from django.db.models import Prefetch, QuerySet

from ..models import AnimeCharacter, AnimeStaff, Staff, UserFavoriteStaff
from ..serializers import StaffDetailSerializer
from .characters import (
    DETAIL_PERSON_FIELDS,
    PERSON_FIELDS,
    ROLE_ANIME_FIELDS,
    CachedPersonDetailViewSet,
    prefixed,
    visible_anime_ids,
)


class StaffViewSet(CachedPersonDetailViewSet):
    """Staff detail endpoint (voice roles and production credits)."""

    serializer_class = StaffDetailSerializer
    CACHE_PREFIX = "staff"
    favorite_model = UserFavoriteStaff
    favorite_field = "staff"

    def detail_queryset(self, can_view_adult_content: bool) -> QuerySet:
        visible = visible_anime_ids(can_view_adult_content)
        voice_roles = (
            AnimeCharacter.objects.filter(anime__in=visible)
            .select_related("anime", "character")
            .only(
                "id",
                "role",
                "anime_id",
                "character_id",
                "voice_actor_id",
                *ROLE_ANIME_FIELDS,
                *prefixed("character", PERSON_FIELDS),
            )
            .order_by("-anime__release_date", "id")
        )
        production_credits = (
            AnimeStaff.objects.filter(anime__in=visible)
            .select_related("anime")
            .only("id", "role", "anime_id", "staff_id", *ROLE_ANIME_FIELDS)
            .order_by("-anime__release_date", "id")
        )
        return Staff.objects.only(*DETAIL_PERSON_FIELDS).prefetch_related(
            Prefetch("voice_roles", queryset=voice_roles),
            Prefetch("production_credits", queryset=production_credits),
        )
