from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.http import Http404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from ...animes.models import Anime
from ..models import UserAnimeList
from .cache import (
    invalidate_anime_detail_cache,
    invalidate_user_anime_caches,
    invalidate_user_caches,
)

User = get_user_model()


def get_user_anime_list_queryset(request_user, username=None, list_status=None):
    queryset = UserAnimeList.objects.all()

    if username:
        try:
            target_user = User.objects.select_related("userprofile").get(username=username)
        except User.DoesNotExist as exc:
            raise Http404 from exc

        if target_user != request_user:
            profile = getattr(target_user, "userprofile", None)
            if profile and profile.is_private:
                return UserAnimeList.objects.none()
        queryset = queryset.filter(user=target_user)
    elif request_user.is_authenticated:
        queryset = queryset.filter(user=request_user)
    else:
        return UserAnimeList.objects.none()

    queryset = queryset.select_related("anime").prefetch_related(
        "anime__genres", Anime.studios_prefetch("anime__")
    )
    if list_status:
        queryset = queryset.filter(status=list_status)
    return queryset.order_by("-updated_at")


def create_user_anime_list_entry(serializer, user):
    try:
        serializer.save(user=user)
    except IntegrityError as exc:
        raise serializers.ValidationError({"detail": "This anime is already in your list."}) from exc

    invalidate_user_caches(user.id, user.username)
    invalidate_user_anime_caches(user.id)
    invalidate_anime_detail_cache(serializer.instance.anime.slug, user.id)


def update_user_anime_list_entry(serializer, user):
    if serializer.instance.user != user:
        raise PermissionDenied("You can only modify your own anime list.")

    serializer.save()
    invalidate_user_caches(user.id, user.username)
    invalidate_user_anime_caches(user.id)
    invalidate_anime_detail_cache(serializer.instance.anime.slug, user.id)


def delete_user_anime_list_entry(instance, user):
    if instance.user != user:
        raise PermissionDenied("You can only remove items from your own anime list.")

    anime_slug = instance.anime.slug
    instance.delete()
    invalidate_user_caches(user.id, user.username)
    invalidate_user_anime_caches(user.id)
    invalidate_anime_detail_cache(anime_slug, user.id)
