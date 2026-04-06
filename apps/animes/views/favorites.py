from rest_framework import mixins, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from apps.animes.services.favorites import (
    delete_favorite,
    get_character_favorite_queryset,
    get_favorite_queryset,
    get_staff_favorite_queryset,
    reorder_favorites,
    toggle_character_favorite,
    toggle_favorite,
    toggle_staff_favorite,
)
from apps.users.permissions import EmailVerificationMixin
from apps.users.serializers.users import (
    CharacterFavoriteSerializer,
    FavoriteCompactSerializer,
    FavoriteSerializer,
    StaffFavoriteSerializer,
)


class FavoriteViewSet(EmailVerificationMixin, ModelViewSet):
    """Manage user favorites with email verification enforcement."""

    serializer_class = FavoriteSerializer

    def get_serializer_class(self):
        if self.request and self.request.query_params.get("compact") == "true":
            return FavoriteCompactSerializer
        return super().get_serializer_class()

    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to add favorites."

    def get_queryset(self):
        return get_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    def perform_destroy(self, instance):
        delete_favorite(instance, self.request.user)

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        self.check_email_verified(request.user)
        result = toggle_favorite(request.user, request.data.get("anime_id"))
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        result = reorder_favorites(request.user, request.data.get("items", []))
        return Response(result.payload, status=result.status_code)


class CharacterFavoriteViewSet(
    EmailVerificationMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    serializer_class = CharacterFavoriteSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to add favorite characters."

    def get_queryset(self):
        return get_character_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        self.check_email_verified(request.user)
        result = toggle_character_favorite(request.user, request.data.get("character_id"))
        return Response(result.payload, status=result.status_code)


class StaffFavoriteViewSet(
    EmailVerificationMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    GenericViewSet,
):
    serializer_class = StaffFavoriteSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to add favorite voice actors."

    def get_queryset(self):
        return get_staff_favorite_queryset(
            self.request.user,
            username=self.request.query_params.get("username"),
        )

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        self.check_email_verified(request.user)
        result = toggle_staff_favorite(request.user, request.data.get("staff_id"))
        return Response(result.payload, status=result.status_code)
