from typing import cast

from django.db.models import Count, Model, Prefetch, Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from rest_framework.mixins import RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from ...shared.parsing import positive_int
from ...shared.public_cache import get_or_build_public_payload
from ..models import Anime, AnimeCharacter, Character, UserFavoriteCharacter
from ..serializers import CharacterDetailSerializer
from ..services.public_anime_service import AnimePublicPayloadService, AnimeQueryService

# What the role serializers read (``StaffVoiceRoleAnimeSerializer`` and the
# compact person serializers); never the whole Anime row (B15).
ROLE_ANIME_FIELDS = (
    "anime__id",
    "anime__title",
    "anime__slug",
    "anime__release_date",
    "anime__cover_image",
    "anime__cover_image_external_url",
)
PERSON_FIELDS = ("id", "name", "name_native", "image", "image_url")
DETAIL_PERSON_FIELDS = (*PERSON_FIELDS, "anilist_id", "description")


def visible_anime_ids(can_view_adult_content: bool) -> QuerySet:
    """The anime whose roles a viewer may see: public, and non-adult unless opted in."""
    queryset = Anime.public_queryset()
    if not can_view_adult_content:
        queryset = queryset.filter(is_adult=False)
    return queryset.values("pk")


def prefixed(prefix: str, fields: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(f"{prefix}__{field}" for field in fields)


class CachedPersonDetailViewSet(RetrieveModelMixin, GenericViewSet):
    """A character or staff page: retrieve only, every role in one payload.

    The payload is cached per adult-content setting (``{CACHE_PREFIX}:{id}:adult:{0|1}``
    under the catalog namespace,
    10 min) and built without the viewer; the favourite count and the viewer's
    own favourite state are read per request, in one query. There is no list
    action: it returned the whole table.
    """

    pagination_class = None
    CACHE_TTL = 600
    CACHE_PREFIX: str
    favorite_model: type[Model]
    favorite_field: str

    def detail_queryset(self, can_view_adult_content: bool) -> QuerySet:
        raise NotImplementedError

    def retrieve(self, request, *args, **kwargs):
        object_id = positive_int(kwargs.get(self.lookup_field), allow_bool=False)
        if object_id is None:
            raise NotFound()
        can_view_adult_content = AnimeQueryService.can_view_adult_content(request.user)

        def build_payload():
            instance = get_object_or_404(self.detail_queryset(can_view_adult_content), pk=object_id)
            return self.get_serializer(instance).data

        # Under the catalog namespace: the anime list on the page follows every
        # visibility change (a title flagged adult or quarantined) at once.
        data, cache_status = get_or_build_public_payload(
            AnimePublicPayloadService._with_collection_namespace(
                f"{self.CACHE_PREFIX}:{object_id}:adult:{int(can_view_adult_content)}"
            ),
            build_payload,
            ttl=self.CACHE_TTL,
        )
        payload = cast("dict", data)
        response = Response({**payload, **self.favorite_state(object_id, request.user)})
        response["X-Cache-Status"] = cache_status
        return response

    def favorite_state(self, object_id: int, user) -> dict:
        """``favorite_count`` and ``is_favorite``, fresh: a toggle refetches the page."""
        aggregates = {"favorite_count": Count("id")}
        if user.is_authenticated:
            aggregates["is_favorite"] = Count("id", filter=Q(user_id=user.id))
        counts = self.favorite_model._default_manager.filter(
            **{f"{self.favorite_field}_id": object_id}
        ).aggregate(**aggregates)
        return {
            "favorite_count": counts["favorite_count"],
            "is_favorite": bool(counts.get("is_favorite")),
        }


class CharacterViewSet(CachedPersonDetailViewSet):
    """Character detail endpoint."""

    serializer_class = CharacterDetailSerializer
    CACHE_PREFIX = "character"
    favorite_model = UserFavoriteCharacter
    favorite_field = "character"

    def detail_queryset(self, can_view_adult_content: bool) -> QuerySet:
        roles = (
            AnimeCharacter.objects.filter(anime__in=visible_anime_ids(can_view_adult_content))
            .select_related("anime", "voice_actor")
            .only(
                "id",
                "role",
                "anime_id",
                "character_id",
                "voice_actor_id",
                *ROLE_ANIME_FIELDS,
                *prefixed("voice_actor", PERSON_FIELDS),
            )
            .order_by("-anime__release_date", "id")
        )
        return Character.objects.only(*DETAIL_PERSON_FIELDS).prefetch_related(
            Prefetch("roles", queryset=roles)
        )
