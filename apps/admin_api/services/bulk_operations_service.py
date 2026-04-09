from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db.models import BooleanField, Case, Count, Value, When

from ...animes.models import Anime, Character, Genre, Review, Staff, Studio, UserFavorite

User = get_user_model()


class BulkOperationError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class BulkOperationResult:
    payload: dict
    status_code: int


def perform_bulk_operation(operation: str, entity_type: str, entity_ids, request_user, data):
    if not operation or not entity_type or not entity_ids:
        raise BulkOperationError("operation, entity_type, and entity_ids are required.", 400)

    if not isinstance(entity_ids, list):
        raise BulkOperationError("entity_ids must be a list.", 400)
    data = data or {}

    normalized_entity = {
        "anime": "anime",
        "animes": "anime",
        "review": "review",
        "reviews": "review",
        "user": "user",
        "users": "user",
        "genre": "genre",
        "genres": "genre",
        "studio": "studio",
        "studios": "studio",
        "favorite": "favorite",
        "favorites": "favorite",
        "character": "character",
        "characters": "character",
        "staff": "staff",
        "staff_members": "staff",
    }.get(entity_type)

    if normalized_entity == "anime":
        return _handle_anime_bulk(operation, entity_ids, data, request_user)
    if normalized_entity == "review":
        return _handle_review_bulk(operation, entity_ids)
    if normalized_entity == "user":
        return _handle_user_bulk(operation, entity_ids, request_user)
    if normalized_entity == "genre":
        return _handle_genre_bulk(operation, entity_ids, data)
    if normalized_entity == "studio":
        return _handle_studio_bulk(operation, entity_ids, data)
    if normalized_entity == "favorite":
        return _handle_favorite_bulk(operation, entity_ids)
    if normalized_entity == "character":
        return _handle_character_bulk(operation, entity_ids)
    if normalized_entity == "staff":
        return _handle_staff_bulk(operation, entity_ids)

    raise BulkOperationError(f"Unsupported entity_type: {entity_type}", 400)


def _handle_anime_bulk(operation: str, ids, data, request_user):
    if operation == "update_status":
        new_status = data.get("status")
        if not new_status:
            raise BulkOperationError("status field required for update_status operation.", 400)
        allowed_statuses = {choice for choice, _ in Anime.AnimeStatus.choices}
        if new_status not in allowed_statuses:
            raise BulkOperationError(f"Invalid status. Allowed values: {', '.join(sorted(allowed_statuses))}.", 400)
        queryset = Anime.objects.filter(id__in=ids)
        updated_count = queryset.update(status=new_status)
        return BulkOperationResult(
            payload={"message": f"Updated status to {new_status} for {updated_count} anime."},
            status_code=200,
        )

    if operation == "delete":
        if not request_user.is_superuser:
            raise BulkOperationError("Only superusers can delete anime in bulk.", 403)
        queryset = Anime.objects.filter(id__in=ids)
        deleted_count, _ = queryset.delete()
        return BulkOperationResult(
            payload={"message": f"Deleted {deleted_count} anime."},
            status_code=200,
        )

    raise BulkOperationError(f"Unsupported anime operation: {operation}", 400)


def _handle_review_bulk(operation: str, ids):
    if operation == "delete":
        queryset = Review.objects.filter(id__in=ids)
        deleted_count, _ = queryset.delete()
        return BulkOperationResult(
            payload={"message": f"Deleted {deleted_count} reviews."},
            status_code=200,
        )

    if operation == "toggle_spoiler":
        queryset = Review.objects.filter(id__in=ids)
        updated = queryset.update(
            has_spoilers=Case(
                When(has_spoilers=True, then=Value(False)),
                default=Value(True),
                output_field=BooleanField(),
            )
        )
        return BulkOperationResult(
            payload={"message": f"Toggled spoiler status for {updated} reviews."},
            status_code=200,
        )

    raise BulkOperationError(f"Unsupported review operation: {operation}", 400)


def _handle_user_bulk(operation: str, ids, request_user):
    users = (
        User.objects.filter(id__in=ids)
        .exclude(id=request_user.id)
        .exclude(is_superuser=True)
    )
    count = users.count()

    if count == 0:
        return BulkOperationResult(
            payload={"message": "No valid users selected for operation."},
            status_code=200,
        )

    if operation == "ban":
        users.update(is_active=False)
        return BulkOperationResult(payload={"message": f"Banned {count} users."}, status_code=200)

    if operation == "unban":
        users.update(is_active=True)
        return BulkOperationResult(
            payload={"message": f"Unbanned {count} users."}, status_code=200
        )

    raise BulkOperationError(f"Unsupported user operation: {operation}", 400)


def _handle_genre_bulk(operation: str, ids, data):
    if operation != "delete":
        raise BulkOperationError(f"Unsupported genre operation: {operation}", 400)

    force_delete = str(data.get("force", "")).lower() in {"1", "true", "yes"}
    queryset = Genre.objects.filter(id__in=ids).annotate(anime_count=Count("anime"))
    blocked = list(queryset.filter(anime_count__gt=0).values_list("name", "anime_count"))
    if blocked and not force_delete:
        sample = ", ".join(f"{name} ({count})" for name, count in blocked[:5])
        raise BulkOperationError(
            f"Cannot delete genres with associated anime: {sample}. Pass force=true to override.",
            400,
        )

    deleted_count, _ = queryset.delete()
    return BulkOperationResult(
        payload={"message": f"Deleted {deleted_count} genres."},
        status_code=200,
    )


def _handle_studio_bulk(operation: str, ids, data):
    if operation != "delete":
        raise BulkOperationError(f"Unsupported studio operation: {operation}", 400)

    force_delete = str(data.get("force", "")).lower() in {"1", "true", "yes"}
    queryset = Studio.objects.filter(id__in=ids).annotate(anime_count=Count("anime"))
    blocked = list(queryset.filter(anime_count__gt=0).values_list("name", "anime_count"))
    if blocked and not force_delete:
        sample = ", ".join(f"{name} ({count})" for name, count in blocked[:5])
        raise BulkOperationError(
            f"Cannot delete studios with associated anime: {sample}. Pass force=true to override.",
            400,
        )

    deleted_count, _ = queryset.delete()
    return BulkOperationResult(
        payload={"message": f"Deleted {deleted_count} studios."},
        status_code=200,
    )


def _handle_favorite_bulk(operation: str, ids):
    if operation != "delete":
        raise BulkOperationError(f"Unsupported favorite operation: {operation}", 400)

    queryset = UserFavorite.objects.filter(id__in=ids)
    deleted_count, _ = queryset.delete()
    return BulkOperationResult(
        payload={"message": f"Deleted {deleted_count} favorites."},
        status_code=200,
    )


def _handle_character_bulk(operation: str, ids):
    if operation != "delete":
        raise BulkOperationError(f"Unsupported character operation: {operation}", 400)

    queryset = Character.objects.filter(id__in=ids)
    deleted_count, _ = queryset.delete()
    return BulkOperationResult(
        payload={"message": f"Deleted {deleted_count} characters."},
        status_code=200,
    )


def _handle_staff_bulk(operation: str, ids):
    if operation != "delete":
        raise BulkOperationError(f"Unsupported staff operation: {operation}", 400)

    queryset = Staff.objects.filter(id__in=ids)
    deleted_count, _ = queryset.delete()
    return BulkOperationResult(
        payload={"message": f"Deleted {deleted_count} staff members."},
        status_code=200,
    )
