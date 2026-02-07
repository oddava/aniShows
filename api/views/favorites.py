from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model

from anime.models import Anime, UserFavorite
from users.models import UserProfile
from api.serializers import FavoriteSerializer

User = get_user_model()


class FavoriteViewSet(viewsets.ModelViewSet):
    """Manage user favorites with email verification enforcement."""

    serializer_class = FavoriteSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

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

        return queryset.select_related("anime__studio").prefetch_related(
            "anime__genres"
        )

    def perform_create(self, serializer):
        # Check email verification
        profile = getattr(self.request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied("Please verify your email to add favorites.")
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        """Ensure users can only delete their own favorites."""
        if instance.user != self.request.user:
            raise PermissionDenied("You can only remove your own favorites.")
        instance.delete()

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        """Toggle favorite status for an anime"""
        anime_id = request.data.get("anime_id")
        if not anime_id:
            return Response({"error": "anime_id required"}, status=400)

        try:
            anime = Anime.objects.get(id=anime_id)
        except Anime.DoesNotExist:
            return Response({"error": "Anime not found"}, status=404)

        # Check email verification
        profile = getattr(request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            return Response(
                {"error": "Please verify your email to add favorites."},
                status=403,
            )

        favorite, created = UserFavorite.objects.get_or_create(
            user=request.user, anime=anime
        )

        if not created:
            favorite.delete()
            return Response({"is_favorite": False, "message": "Removed from favorites"})

        return Response({"is_favorite": True, "message": "Added to favorites"})

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Reorder user's favorites"""
        items = request.data.get("items", [])
        if not items:
            return Response({"error": "items required"}, status=400)

        # Update the order for each favorite
        for item in items:
            try:
                favorite = UserFavorite.objects.get(id=item["id"], user=request.user)
                favorite.order = item.get("order", 0)
                favorite.save(update_fields=["order"])
            except UserFavorite.DoesNotExist:
                continue

        return Response({"message": "Order saved successfully"})
