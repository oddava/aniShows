from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import Http404
from rest_framework.exceptions import PermissionDenied

from ...users.services.cache import invalidate_user_caches
from ..models import (
    Anime,
    Character,
    Staff,
    UserFavorite,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)

User = get_user_model()


@dataclass(slots=True)
class FavoriteActionResult:
    payload: dict
    status_code: int


def _get_target_user(request_user, username=None):
    if username:
        try:
            target_user = User.objects.select_related("userprofile").get(username=username)
        except User.DoesNotExist as exc:
            raise Http404 from exc

        if target_user != request_user:
            profile = getattr(target_user, "userprofile", None)
            if profile and profile.is_private:
                return None
        return target_user

    if request_user.is_authenticated:
        return request_user

    return None


def get_favorite_queryset(request_user, username=None):
    target_user = _get_target_user(request_user, username=username)
    if target_user is None:
        return UserFavorite.objects.none()

    return (
        UserFavorite.objects.filter(user=target_user)
        .select_related("anime__studio")
        .prefetch_related("anime__genres")
    )


def get_character_favorite_queryset(request_user, username=None):
    target_user = _get_target_user(request_user, username=username)
    if target_user is None:
        return UserFavoriteCharacter.objects.none()

    return UserFavoriteCharacter.objects.filter(user=target_user).select_related("character")


def get_staff_favorite_queryset(request_user, username=None):
    target_user = _get_target_user(request_user, username=username)
    if target_user is None:
        return UserFavoriteStaff.objects.none()

    return UserFavoriteStaff.objects.filter(user=target_user).select_related("staff")


def delete_favorite(instance, user):
    if instance.user != user:
        raise PermissionDenied("You can only remove your own favorites.")
    instance.delete()


def _toggle_model_favorite(
    *,
    user,
    object_id,
    model,
    favorite_model,
    field_name,
    not_found_message,
    trigger_stats_update=False,
):
    if not object_id:
        return FavoriteActionResult(payload={"error": f"{field_name}_id required"}, status_code=400)

    try:
        with transaction.atomic():
            locked_user = User.objects.select_for_update().get(pk=user.pk)
            instance = model.objects.select_for_update().get(id=object_id)

            favorite = favorite_model.objects.select_for_update().filter(
                user=locked_user,
                **{field_name: instance},
            ).first()
            if favorite:
                favorite.delete()
                is_favorite = False
                message = "Removed from favorites"
                status_code = 200
            else:
                favorite_model.objects.create(user=locked_user, **{field_name: instance})
                is_favorite = True
                message = "Added to favorites"
                status_code = 200

            favorite_count = favorite_model.objects.filter(**{field_name: instance}).count()
            transaction.on_commit(
                lambda: invalidate_user_caches(
                    locked_user.id,
                    locked_user.username,
                    trigger_stats_update=trigger_stats_update,
                )
            )
    except model.DoesNotExist:
        return FavoriteActionResult(payload={"error": not_found_message}, status_code=404)

    return FavoriteActionResult(
        payload={
            "is_favorite": is_favorite,
            "favorite_count": favorite_count,
            "message": message,
        },
        status_code=status_code,
    )


def toggle_favorite(user, anime_id):
    return _toggle_model_favorite(
        user=user,
        object_id=anime_id,
        model=Anime,
        favorite_model=UserFavorite,
        field_name="anime",
        not_found_message="Anime not found",
        trigger_stats_update=True,
    )


def toggle_character_favorite(user, character_id):
    return _toggle_model_favorite(
        user=user,
        object_id=character_id,
        model=Character,
        favorite_model=UserFavoriteCharacter,
        field_name="character",
        not_found_message="Character not found",
    )


def toggle_staff_favorite(user, staff_id):
    return _toggle_model_favorite(
        user=user,
        object_id=staff_id,
        model=Staff,
        favorite_model=UserFavoriteStaff,
        field_name="staff",
        not_found_message="Staff member not found",
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
