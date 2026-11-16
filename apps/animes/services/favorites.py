from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Min, Model
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


@dataclass(frozen=True, slots=True)
class _FavoriteKind:
    """One favoritable catalog model and the table that links users to it."""

    model: type[Model]
    favorite_model: type[Model]
    field_name: str
    not_found_message: str
    trigger_stats_update: bool = False


ANIME_FAVORITES = _FavoriteKind(
    model=Anime,
    favorite_model=UserFavorite,
    field_name="anime",
    not_found_message="Anime not found",
    trigger_stats_update=True,
)
CHARACTER_FAVORITES = _FavoriteKind(
    model=Character,
    favorite_model=UserFavoriteCharacter,
    field_name="character",
    not_found_message="Character not found",
)
STAFF_FAVORITES = _FavoriteKind(
    model=Staff,
    favorite_model=UserFavoriteStaff,
    field_name="staff",
    not_found_message="Staff member not found",
)


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
        .select_related("anime")
        .prefetch_related("anime__genres", Anime.studios_prefetch("anime__"))
        .order_by("order", "-added_at", "id")
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


def _new_favorite_fields(user, kind: _FavoriteKind) -> dict:
    """A new anime favorite goes first without renumbering the rest: min(order) - 1."""
    if kind.favorite_model is not UserFavorite:
        return {}
    lowest = UserFavorite.objects.filter(user=user).aggregate(lowest=Min("order"))["lowest"]
    return {"order": 0 if lowest is None else lowest - 1}


def _add_favorite(user, kind: _FavoriteKind, lookup: dict) -> None:
    try:
        with transaction.atomic():
            kind.favorite_model._default_manager.create(
                **lookup, **_new_favorite_fields(user, kind)
            )
    except IntegrityError:
        # A parallel toggle by the same user added it first (unique pair): same outcome.
        pass


def _toggle(user, object_id: int, kind: _FavoriteKind) -> FavoriteActionResult:
    """Add or remove a favorite without row locks; the unique pair keeps it consistent."""
    if not kind.model._default_manager.filter(pk=object_id).exists():
        return FavoriteActionResult(
            payload={"detail": kind.not_found_message, "code": "not_found"},
            status_code=404,
        )

    target = {f"{kind.field_name}_id": object_id}
    lookup = {"user": user, **target}
    removed, _ = kind.favorite_model._default_manager.filter(**lookup).delete()
    if not removed:
        _add_favorite(user, kind, lookup)

    favorite_count = kind.favorite_model._default_manager.filter(**target).count()
    transaction.on_commit(
        lambda: invalidate_user_caches(
            user.id, user.username, trigger_stats_update=kind.trigger_stats_update
        )
    )
    return FavoriteActionResult(
        payload={
            "is_favorite": not removed,
            "favorite_count": favorite_count,
            "message": "Removed from favorites" if removed else "Added to favorites",
        },
        status_code=200,
    )


def toggle_favorite(user, anime_id: int) -> FavoriteActionResult:
    return _toggle(user, anime_id, ANIME_FAVORITES)


def toggle_character_favorite(user, character_id: int) -> FavoriteActionResult:
    return _toggle(user, character_id, CHARACTER_FAVORITES)


def toggle_staff_favorite(user, staff_id: int) -> FavoriteActionResult:
    return _toggle(user, staff_id, STAFF_FAVORITES)


def reorder_favorites(user, ids: list[int]) -> FavoriteActionResult:
    """Put ``ids`` first as 0..n-1; the user's other favorites follow in their current order.

    Every favorite of the user is renumbered in one transaction (rows locked), so
    the result is a strict total order even when only one page was reordered.
    """
    with transaction.atomic():
        current = list(
            UserFavorite.objects.select_for_update()
            .filter(user=user)
            .order_by("order", "-added_at", "id")
            .values_list("id", "order")
        )
        current_order = dict(current)
        if not set(ids).issubset(current_order):
            return FavoriteActionResult(
                payload={
                    "detail": "Some favorites were not found.",
                    "code": "invalid_favorites",
                },
                status_code=400,
            )

        listed = set(ids)
        final_ids = [
            *ids,
            *(favorite_id for favorite_id, _ in current if favorite_id not in listed),
        ]
        changed = [
            UserFavorite(id=favorite_id, order=position)
            for position, favorite_id in enumerate(final_ids)
            if current_order[favorite_id] != position
        ]
        UserFavorite.objects.bulk_update(changed, ["order"], batch_size=500)

    return FavoriteActionResult(
        payload={"message": "Order saved successfully", "count": len(final_ids)},
        status_code=200,
    )
