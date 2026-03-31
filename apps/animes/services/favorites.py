from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.http import Http404
from rest_framework.exceptions import PermissionDenied

from apps.animes.models import Anime, UserFavorite
from apps.users.services.cache import invalidate_user_caches

User = get_user_model()


@dataclass(slots=True)
class FavoriteActionResult:
    payload: dict
    status_code: int


def get_favorite_queryset(request_user, username=None):
    queryset = UserFavorite.objects.all()

    if username:
        try:
            target_user = User.objects.select_related("userprofile").get(username=username)
        except User.DoesNotExist as exc:
            raise Http404 from exc

        if target_user != request_user:
            profile = getattr(target_user, "userprofile", None)
            if profile and profile.is_private:
                return UserFavorite.objects.none()
        queryset = queryset.filter(user=target_user)
    elif request_user.is_authenticated:
        queryset = queryset.filter(user=request_user)
    else:
        return UserFavorite.objects.none()

    return queryset.select_related("anime__studio").prefetch_related("anime__genres")


def delete_favorite(instance, user):
    if instance.user != user:
        raise PermissionDenied("You can only remove your own favorites.")
    instance.delete()


def toggle_favorite(user, anime_id):
    if not anime_id:
        return FavoriteActionResult(payload={"error": "anime_id required"}, status_code=400)

    try:
        anime = Anime.objects.get(id=anime_id)
    except Anime.DoesNotExist:
        return FavoriteActionResult(payload={"error": "Anime not found"}, status_code=404)

    favorite, created = UserFavorite.objects.get_or_create(user=user, anime=anime)
    if not created:
        favorite.delete()
        invalidate_user_caches(user.id, user.username)
        return FavoriteActionResult(
            payload={"is_favorite": False, "message": "Removed from favorites"},
            status_code=200,
        )

    invalidate_user_caches(user.id, user.username)
    return FavoriteActionResult(
        payload={"is_favorite": True, "message": "Added to favorites"},
        status_code=200,
    )


def reorder_favorites(user, items):
    if not items:
        return FavoriteActionResult(payload={"error": "items required"}, status_code=400)

    item_ids = [item["id"] for item in items if "id" in item]
    favorites = UserFavorite.objects.filter(id__in=item_ids, user=user)
    favorites_by_id = {favorite.id: favorite for favorite in favorites}

    to_update = []
    for item in items:
        favorite = favorites_by_id.get(item.get("id"))
        if favorite:
            favorite.order = item.get("order", 0)
            to_update.append(favorite)

    if to_update:
        UserFavorite.objects.bulk_update(to_update, ["order"])

    return FavoriteActionResult(
        payload={"message": "Order saved successfully"},
        status_code=200,
    )
