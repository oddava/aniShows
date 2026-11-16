"""Bulk admin operations with safety rails (G6 P1-4).

At most ``MAX_BULK_IDS`` positive integer ids; everything runs in one transaction
and writes one ``BULK_ACTION`` audit row. ``dry_run`` reports what a delete would
remove (cascades included) without deleting. A real delete needs ``confirm`` equal
to the number of matched rows, so a stale selection cannot delete more than the
admin saw. Reviews are deleted and edited one by one (``Review.delete()``/``save()``)
so G5's signals run; user ban/unban goes through the suspension service.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db import DEFAULT_DB_ALIAS, transaction
from django.db.models import Count, Model
from django.db.models.deletion import Collector

from ...animes.models import Anime, Character, Genre, Review, Staff, Studio, UserFavorite
from ...core.models import AuditLog
from .audit import mark_nothing_to_audit, record_admin_action
from .user_admin_service import AdminUserActionError, clean_reason, set_user_active

User = get_user_model()

MAX_BULK_IDS = 100

ENTITY_ALIASES = {
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
}
ENTITY_MODELS: dict[str, type[Model]] = {
    "anime": Anime,
    "review": Review,
    "user": User,
    "genre": Genre,
    "studio": Studio,
    "favorite": UserFavorite,
    "character": Character,
    "staff": Staff,
}
ENTITY_OPERATIONS = {
    "anime": {"delete"},
    "review": {"delete", "toggle_spoiler"},
    "user": {"ban", "unban"},
    "genre": {"delete"},
    "studio": {"delete"},
    "favorite": {"delete"},
    "character": {"delete"},
    "staff": {"delete"},
}
NOUNS = {
    "anime": "anime",
    "review": "reviews",
    "user": "users",
    "genre": "genres",
    "studio": "studios",
    "favorite": "favorites",
    "character": "characters",
    "staff": "staff members",
}


class BulkOperationError(Exception):
    def __init__(self, message: str, status_code: int, extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}


@dataclass(slots=True)
class BulkOperationResult:
    payload: dict
    status_code: int


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def clean_ids(raw) -> list[int]:
    if not isinstance(raw, list) or not raw:
        raise BulkOperationError("entity_ids must be a non-empty list.", 400)
    if len(raw) > MAX_BULK_IDS:
        raise BulkOperationError(f"At most {MAX_BULK_IDS} ids per operation.", 400)
    ids = []
    for value in raw:
        if isinstance(value, bool):
            raise BulkOperationError("entity_ids must be positive integers.", 400)
        try:
            coerced = int(value)
        except (TypeError, ValueError) as exc:
            raise BulkOperationError("entity_ids must be positive integers.", 400) from exc
        if coerced < 1 or str(value).strip() != str(coerced):
            raise BulkOperationError("entity_ids must be positive integers.", 400)
        ids.append(coerced)
    return sorted(set(ids))


def _target_queryset(entity: str, ids: list[int], actor):
    queryset = ENTITY_MODELS[entity]._default_manager.filter(id__in=ids)
    if entity == "user":
        # Bulk never touches staff: suspend a staff account one at a time, on purpose.
        queryset = queryset.exclude(id=actor.pk).exclude(is_superuser=True).exclude(is_staff=True)
    return queryset


def would_delete_by_model(queryset) -> dict[str, int]:
    """What ``queryset.delete()`` would remove, per model label, without deleting."""
    collector = Collector(using=queryset.db or DEFAULT_DB_ALIAS)
    collector.collect(list(queryset))
    counts: Counter[str] = Counter()
    for model, instances in collector.data.items():
        counts[model._meta.label] += len(instances)
    for fast_queryset in collector.fast_deletes:
        counts[fast_queryset.model._meta.label] += fast_queryset.count()
    return {label: total for label, total in sorted(counts.items()) if total}


def _check_catalog_links(entity: str, queryset, force: bool) -> None:
    if entity not in {"genre", "studio"} or force:
        return
    blocked = list(
        queryset.annotate(anime_count=Count("anime"))
        .filter(anime_count__gt=0)
        .values_list("name", "anime_count")
    )
    if blocked:
        sample = ", ".join(f"{name} ({count})" for name, count in blocked[:5])
        raise BulkOperationError(
            f"Cannot delete {NOUNS[entity]} with associated anime: {sample}. "
            "Pass force=true to override.",
            400,
        )


def _delete(entity: str, queryset) -> dict[str, int]:
    if entity == "review":
        counts: Counter[str] = Counter()
        for review in queryset:
            _total, by_model = review.delete()
            counts.update(by_model)
        return dict(counts)
    _total, by_model = queryset.delete()
    return dict(by_model)


def _toggle_spoilers(queryset) -> int:
    updated = 0
    for review in queryset:
        review.has_spoilers = not review.has_spoilers
        review.save(update_fields=["has_spoilers", "updated_at"])
        updated += 1
    return updated


def perform_bulk_operation(request, data) -> BulkOperationResult:
    data = data if isinstance(data, dict) else {}
    operation = data.get("operation")
    raw_entity = data.get("entity_type") or data.get("entity")
    raw_ids = data.get("entity_ids") if data.get("entity_ids") is not None else data.get("ids")
    if not operation or not raw_entity or raw_ids is None:
        raise BulkOperationError("operation, entity_type, and entity_ids are required.", 400)

    entity = ENTITY_ALIASES.get(str(raw_entity))
    if entity is None:
        raise BulkOperationError(f"Unsupported entity_type: {raw_entity}", 400)
    if operation not in ENTITY_OPERATIONS[entity]:
        allowed = ", ".join(sorted(ENTITY_OPERATIONS[entity]))
        raise BulkOperationError(f"Unsupported {entity} operation. Allowed: {allowed}.", 400)
    ids = clean_ids(raw_ids)
    dry_run = _truthy(data.get("dry_run"))
    force = _truthy(data.get("force"))
    reason = ""
    if operation in {"ban", "unban"}:
        try:
            reason = clean_reason(data.get("reason"))
        except AdminUserActionError as exc:
            raise BulkOperationError(exc.message, exc.status_code) from exc

    with transaction.atomic():
        queryset = _target_queryset(entity, ids, request.user)
        locked_users: list = []
        if entity == "user":
            # Lock first, so the exclusions and the count reflect the rows really changed.
            locked_users = list(queryset.select_for_update().order_by("pk"))
            matched = len(locked_users)
        else:
            matched = queryset.count()
        base = {"operation": operation, "entity_type": entity, "matched": matched}

        if dry_run:
            mark_nothing_to_audit(request)
            payload = {"dry_run": True, **base}
            if operation == "delete":
                payload["would_delete_by_model"] = would_delete_by_model(queryset)
            return BulkOperationResult(payload=payload, status_code=200)

        if matched == 0:
            mark_nothing_to_audit(request)
            return BulkOperationResult(
                payload={**base, "message": f"No matching {NOUNS[entity]} selected."},
                status_code=200,
            )

        label = ENTITY_MODELS[entity]._meta.label
        metadata: dict = {"operation": operation, "ids": ids, "matched": matched}
        if operation == "delete":
            if str(data.get("confirm", "")).strip() != str(matched):
                raise BulkOperationError(
                    f"Confirm the delete by sending confirm={matched}.", 400, {"matched": matched}
                )
            _check_catalog_links(entity, queryset, force)
            deleted_by_model = _delete(entity, queryset)
            metadata["deleted_by_model"] = deleted_by_model
            payload = {
                **base,
                "deleted_by_model": deleted_by_model,
                "message": f"Deleted {deleted_by_model.get(label, 0)} {NOUNS[entity]}.",
            }
        elif operation == "toggle_spoiler":
            updated = _toggle_spoilers(queryset)
            metadata["updated"] = updated
            payload = {
                **base,
                "updated": updated,
                "message": f"Toggled spoiler status for {updated} reviews.",
            }
        else:  # ban / unban
            active = operation == "unban"
            changed = [user.pk for user in locked_users if set_user_active(user, active=active)]
            metadata["changed_ids"] = changed
            verb = "Unbanned" if active else "Banned"
            payload = {**base, "updated": len(changed), "message": f"{verb} {len(changed)} users."}

        record_admin_action(
            request,
            action=AuditLog.ActionType.BULK_ACTION,
            entity_type=ENTITY_MODELS[entity].__name__ if entity != "user" else "User",
            entity_repr=f"{operation} {matched} {NOUNS[entity]}",
            metadata=metadata,
            reason=reason,
        )

    return BulkOperationResult(payload=payload, status_code=200)
