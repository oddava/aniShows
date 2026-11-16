from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.throttling import UserRateThrottle
from rest_framework.viewsets import GenericViewSet

from ...core.api_errors import api_response
from ...users.permissions import VerifiedEmailForWrites
from ...users.serializers.favorites import (
    AnimeFavoriteToggleSerializer,
    CharacterFavoriteSerializer,
    CharacterFavoriteToggleSerializer,
    FavoriteCompactSerializer,
    FavoriteReorderSerializer,
    FavoriteSerializer,
    StaffFavoriteSerializer,
    StaffFavoriteToggleSerializer,
)
from ..services.favorites import (
    FavoriteActionResult,
    delete_favorite,
    get_character_favorite_queryset,
    get_favorite_queryset,
    get_staff_favorite_queryset,
    reorder_favorites,
    toggle_character_favorite,
    toggle_favorite,
    toggle_staff_favorite,
)


class FavoriteWriteThrottle(UserRateThrottle):
    scope = "favorite_write"


class _FavoriteViewSetBase(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    """List + delete for one favorite kind; ``toggle``/``reorder`` add the write throttle."""

    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]
    throttled_actions = frozenset({"toggle"})

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action in self.throttled_actions:
            throttles.append(FavoriteWriteThrottle())
        return throttles

    def perform_destroy(self, instance):
        delete_favorite(instance, self.request.user)

    def _respond(self, result: FavoriteActionResult, *, default_code: str):
        return api_response(
            result.payload, status_code=result.status_code, default_code=default_code
        )


class FavoriteViewSet(_FavoriteViewSetBase):
    """Anime favorites: list, delete, toggle and reorder (no create / update)."""

    serializer_class = FavoriteSerializer
    throttled_actions = frozenset({"toggle", "reorder"})

    def get_serializer_class(self):
        if self.request and self.request.query_params.get("compact") == "true":
            return FavoriteCompactSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        return get_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        serializer = AnimeFavoriteToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_favorite(request.user, serializer.validated_data["anime_id"])
        return self._respond(result, default_code="favorite_toggle_failed")

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        serializer = FavoriteReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = reorder_favorites(request.user, serializer.validated_data["ids"])
        return self._respond(result, default_code="favorite_reorder_failed")


class CharacterFavoriteViewSet(_FavoriteViewSetBase):
    serializer_class = CharacterFavoriteSerializer

    def get_queryset(self):
        return get_character_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        serializer = CharacterFavoriteToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_character_favorite(request.user, serializer.validated_data["character_id"])
        return self._respond(result, default_code="favorite_toggle_failed")


class StaffFavoriteViewSet(_FavoriteViewSetBase):
    serializer_class = StaffFavoriteSerializer

    def get_queryset(self):
        return get_staff_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        serializer = StaffFavoriteToggleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_staff_favorite(request.user, serializer.validated_data["staff_id"])
        return self._respond(result, default_code="favorite_toggle_failed")
