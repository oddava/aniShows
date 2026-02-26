from rest_framework import viewsets, serializers, permissions
from rest_framework.exceptions import PermissionDenied
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model

from apps.users.models import UserAnimeList
from apps.animes.serializers import UserAnimeListSerializer
from apps.users.permissions import EmailVerificationMixin
from apps.users.services.cache import (
    invalidate_user_caches,
    invalidate_user_anime_caches,
    invalidate_anime_detail_cache,
)

User = get_user_model()


class UserAnimeListViewSet(EmailVerificationMixin, viewsets.ModelViewSet):
    serializer_class = UserAnimeListSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to add anime to your list."

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

        queryset = queryset.select_related("anime__studio").prefetch_related("anime__genres")

        # Filter by status
        list_status = self.request.query_params.get("status")
        if list_status:
            queryset = queryset.filter(status=list_status)

        return queryset.order_by("-updated_at")

    def perform_create(self, serializer):
        try:
            serializer.save(user=self.request.user)
            # Invalidate user caches - list changes affect stats
            invalidate_user_caches(self.request.user.id, self.request.user.username)
            invalidate_user_anime_caches(self.request.user.id)
            # Invalidate anime detail cache for this specific anime
            invalidate_anime_detail_cache(serializer.instance.anime.slug, self.request.user.id)
        except IntegrityError:
            raise serializers.ValidationError({"detail": "This anime is already in your list."})

    def perform_update(self, serializer):
        """Ensure users can only update their own list entries."""
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only modify your own anime list.")
        serializer.save()
        # Invalidate user caches - list changes affect stats
        invalidate_user_caches(self.request.user.id, self.request.user.username)
        invalidate_user_anime_caches(self.request.user.id)
        # Invalidate anime detail cache for this specific anime
        invalidate_anime_detail_cache(serializer.instance.anime.slug, self.request.user.id)

    def perform_destroy(self, instance):
        """Ensure users can only delete their own list entries."""
        if instance.user != self.request.user:
            raise PermissionDenied("You can only remove items from your own anime list.")
        # Get anime slug before deletion
        anime_slug = instance.anime.slug
        instance.delete()
        # Invalidate user caches - list changes affect stats
        invalidate_user_caches(self.request.user.id, self.request.user.username)
        invalidate_user_anime_caches(self.request.user.id)
        # Invalidate anime detail cache for this specific anime
        invalidate_anime_detail_cache(anime_slug, self.request.user.id)
