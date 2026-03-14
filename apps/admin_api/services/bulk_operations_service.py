from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db.models import BooleanField, Case, Value, When

from apps.animes.models import Anime, Review

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

    if entity_type == "anime":
        return _handle_anime_bulk(operation, entity_ids, data)
    if entity_type == "review":
        return _handle_review_bulk(operation, entity_ids)
    if entity_type == "user":
        return _handle_user_bulk(operation, entity_ids, request_user)

    raise BulkOperationError(f"Unsupported entity_type: {entity_type}", 400)


def _handle_anime_bulk(operation: str, ids, data):
    if operation == "update_status":
        new_status = data.get("status")
        if not new_status:
            raise BulkOperationError("status field required for update_status operation.", 400)
        updated_count = Anime.objects.filter(id__in=ids).update(status=new_status)
        return BulkOperationResult(
            payload={"message": f"Updated status to {new_status} for {updated_count} anime."},
            status_code=200,
        )

    if operation == "delete":
        deleted_count, _ = Anime.objects.filter(id__in=ids).delete()
        return BulkOperationResult(
            payload={"message": f"Deleted {deleted_count} anime."},
            status_code=200,
        )

    raise BulkOperationError(f"Unsupported anime operation: {operation}", 400)


def _handle_review_bulk(operation: str, ids):
    if operation == "delete":
        deleted_count, _ = Review.objects.filter(id__in=ids).delete()
        return BulkOperationResult(
            payload={"message": f"Deleted {deleted_count} reviews."},
            status_code=200,
        )

    if operation == "toggle_spoiler":
        updated = Review.objects.filter(id__in=ids).update(
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
