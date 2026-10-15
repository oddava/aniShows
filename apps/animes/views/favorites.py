from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from ...users.permissions import VerifiedEmailForWrites
from ...users.serializers.users import (
    CharacterFavoriteSerializer,
    FavoriteCompactSerializer,
    FavoriteSerializer,
    StaffFavoriteSerializer,
)
from ..services.favorites import (
    delete_favorite,
    get_character_favorite_queryset,
    get_favorite_queryset,
    get_staff_favorite_queryset,
    reorder_favorites,
    toggle_character_favorite,
    toggle_favorite,
    toggle_staff_favorite,
)


class FavoriteViewSet(ModelViewSet):
    """Manage user favorites."""

    serializer_class = FavoriteSerializer

    def get_serializer_class(self):
        if self.request and self.request.query_params.get("compact") == "true":
            return FavoriteCompactSerializer
        return super().get_serializer_class()

    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_queryset(self):
        return get_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only modify your own favorites.")
        serializer.save()

    def perform_destroy(self, instance):
        delete_favorite(instance, self.request.user)

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        result = toggle_favorite(request.user, request.data.get("anime_id"))
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        result = reorder_favorites(request.user, request.data.get("items", []))
        return Response(result.payload, status=result.status_code)


class CharacterFavoriteViewSet(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    serializer_class = CharacterFavoriteSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_queryset(self):
        return get_character_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    def perform_destroy(self, instance):
        delete_favorite(instance, self.request.user)

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        result = toggle_character_favorite(request.user, request.data.get("character_id"))
        return Response(result.payload, status=result.status_code)


class StaffFavoriteViewSet(
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    serializer_class = StaffFavoriteSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_queryset(self):
        return get_staff_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    def perform_destroy(self, instance):
        delete_favorite(instance, self.request.user)

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        result = toggle_staff_favorite(request.user, request.data.get("staff_id"))
        return Response(result.payload, status=result.status_code)
