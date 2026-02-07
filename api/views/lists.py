from rest_framework import viewsets, serializers, permissions
from rest_framework.exceptions import PermissionDenied
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model
from django.core.cache import cache

from anime.models import UserFavorite
from users.models import UserProfile, UserAnimeList
from api.serializers import UserAnimeListSerializer

User = get_user_model()


def invalidate_user_anime_cache(user_id):
    """Clear user-specific anime caches when their list changes."""
    cache.delete(f"anime_trending_{user_id}")
    cache.delete(f"anime_top_rated_{user_id}")


class UserAnimeListViewSet(viewsets.ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        username = self.request.query_params.get("username")
        queryset = UserAnimeList.objects.all()

        if username:
            target_user = get_object_or_404(User, username=username)
            if target_user != self.request.user:
                profile = getattr(target_user, "userprofile", None)
                if profile and profile.is_private:
                    return UserAnimeList.objects.none()
            queryset = queryset.filter(user=target_user)
        elif self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            return UserAnimeList.objects.none()

        queryset = queryset.select_related("anime__studio").prefetch_related(
            "anime__genres"
        )

        # Filter by status
        list_status = self.request.query_params.get("status")
        if list_status:
            queryset = queryset.filter(status=list_status)

        return queryset.order_by("-updated_at")

    def perform_create(self, serializer):
        # Check email verification
        profile = getattr(self.request.user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied(
                "Please verify your email to add anime to your list."
            )
        try:
            serializer.save(user=self.request.user)
            invalidate_user_anime_cache(self.request.user.id)
        except IntegrityError:
            raise serializers.ValidationError(
                {"detail": "This anime is already in your list."}
            )

    def perform_update(self, serializer):
        """Ensure users can only update their own list entries."""
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only modify your own anime list.")
        serializer.save()
        invalidate_user_anime_cache(self.request.user.id)

    def perform_destroy(self, instance):
        """Ensure users can only delete their own list entries."""
        if instance.user != self.request.user:
            raise PermissionDenied(
                "You can only remove items from your own anime list."
            )
        instance.delete()
        invalidate_user_anime_cache(self.request.user.id)
