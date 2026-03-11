from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.animes.models import Anime, UserFavorite
from apps.animes.serializers import FavoriteSerializer
from apps.users.permissions import EmailVerificationMixin
from apps.users.services.cache import invalidate_user_caches

User = get_user_model()

class FavoriteViewSet(EmailVerificationMixin, ModelViewSet):
    """Manage user favorites with email verification enforcement."""

    serializer_class = FavoriteSerializer

    def get_serializer_class(self):
        if self.request and self.request.query_params.get("compact") == "true":
            from apps.animes.serializers import FavoriteCompactSerializer
            return FavoriteCompactSerializer
        return super().get_serializer_class()
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to add favorites."

    def get_queryset(self):
        username = self.request.query_params.get("username")
        queryset = UserFavorite.objects.all()

        if username:
            target_user = get_object_or_404(User, username=username)
            if target_user != self.request.user:
                profile = getattr(target_user, "userprofile", None)
                if profile and profile.is_private:
                    return UserFavorite.objects.none()
            queryset = queryset.filter(user=target_user)
        elif self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            return UserFavorite.objects.none()

        return queryset.select_related("anime__studio").prefetch_related("anime__genres")

    def perform_destroy(self, instance):
        if instance.user != self.request.user:
            raise PermissionDenied("You can only remove your own favorites.")
        instance.delete()

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        anime_id = request.data.get("anime_id")
        if not anime_id:
            return Response({"error": "anime_id required"}, status=400)

        try:
            anime = Anime.objects.get(id=anime_id)
        except Anime.DoesNotExist:
            return Response({"error": "Anime not found"}, status=404)

        self.check_email_verified(request.user)

        favorite, created = UserFavorite.objects.get_or_create(user=request.user, anime=anime)

        if not created:
            favorite.delete()
            invalidate_user_caches(request.user.id, request.user.username)
            return Response({"is_favorite": False, "message": "Removed from favorites"})

        invalidate_user_caches(request.user.id, request.user.username)
        return Response({"is_favorite": True, "message": "Added to favorites"})

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        items = request.data.get("items", [])
        if not items:
            return Response({"error": "items required"}, status=400)

        # Batch update: 1 SELECT + 1 bulk UPDATE instead of N*2 individual queries
        item_ids = [item["id"] for item in items if "id" in item]
        favorites = UserFavorite.objects.filter(id__in=item_ids, user=request.user)
        fav_map = {f.id: f for f in favorites}

        to_update = []
        for item in items:
            fav = fav_map.get(item.get("id"))
            if fav:
                fav.order = item.get("order", 0)
                to_update.append(fav)

        if to_update:
            UserFavorite.objects.bulk_update(to_update, ["order"])

        return Response({"message": "Order saved successfully"})
