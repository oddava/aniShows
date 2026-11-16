"""Staff actions on user accounts: suspend, restore, staff flag, delete (G6 P1-2).

Suspending sets ``is_active=False`` and ends every session through G1's
``revoke_all_sessions`` (refresh tokens blacklisted; inactive users' access tokens
are refused by simplejwt). The reason lives in the ``AuditLog`` row, so
``CustomUser`` needs no new field. Each change writes exactly one audit row; a
repeated suspend or restore is a no-op that writes none.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.db.models import Q

from ...core.models import AuditLog
from ...users.services.auth_service import revoke_all_sessions
from .audit import mark_nothing_to_audit, record_admin_action

REASON_MIN_LENGTH = 3
REASON_MAX_LENGTH = 500
MODERATION_HISTORY_LIMIT = 10


class AdminUserActionError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class AdminUserActionResult:
    payload: dict
    status_code: int


def clean_reason(raw) -> str:
    """A suspension/restore reason: required, 3-500 characters after trimming."""
    reason = raw.strip() if isinstance(raw, str) else ""
    if not REASON_MIN_LENGTH <= len(reason) <= REASON_MAX_LENGTH:
        raise AdminUserActionError(
            f"A reason of {REASON_MIN_LENGTH}-{REASON_MAX_LENGTH} characters is required.", 400
        )
    return reason


def check_can_moderate(target_user, actor) -> None:
    """Refuse acting on yourself, on a superuser, and (unless superuser) on staff."""
    if target_user.pk == actor.pk:
        raise AdminUserActionError("You cannot suspend or restore your own account.", 400)
    if target_user.is_superuser:
        raise AdminUserActionError("Superuser accounts cannot be suspended or restored.", 403)
    if target_user.is_staff and not actor.is_superuser:
        raise AdminUserActionError("Only superusers can suspend or restore staff accounts.", 403)


def set_user_active(target_user, *, active: bool) -> bool:
    """Apply suspend/restore without auditing; return whether anything changed.

    Shared by the single-user endpoints and bulk ban/unban. Suspending always
    revokes sessions, even when the account was already inactive.
    """
    with transaction.atomic():
        changed = target_user.is_active != active
        if changed:
            target_user.is_active = active
            target_user.save(update_fields=["is_active"])
        if not active:
            revoke_all_sessions(target_user)
    return changed


@transaction.atomic
def _set_active_and_audit(request, target_user, *, active: bool, raw_reason) -> dict:
    actor = request.user
    check_can_moderate(target_user, actor)
    reason = clean_reason(raw_reason)
    changed = set_user_active(target_user, active=active)
    if changed:
        record_admin_action(
            request,
            action=AuditLog.ActionType.RESTORE if active else AuditLog.ActionType.SUSPEND,
            entity_type="User",
            entity_id=target_user.pk,
            entity_repr=target_user.username,
            previous={"is_active": not active},
            new={"is_active": active},
            reason=reason,
        )
    else:
        mark_nothing_to_audit(request)
    verb = "restored" if active else "suspended"
    return {
        "id": target_user.pk,
        "username": target_user.username,
        "is_active": target_user.is_active,
        "changed": changed,
        "message": f"User {verb}." if changed else f"User was already {verb}.",
    }


def suspend_user(request, target_user, reason) -> AdminUserActionResult:
    return AdminUserActionResult(
        payload=_set_active_and_audit(request, target_user, active=False, raw_reason=reason),
        status_code=200,
    )


def restore_user(request, target_user, reason) -> AdminUserActionResult:
    return AdminUserActionResult(
        payload=_set_active_and_audit(request, target_user, active=True, raw_reason=reason),
        status_code=200,
    )


@transaction.atomic
def set_user_staff(request, target_user, is_staff) -> AdminUserActionResult:
    actor = request.user
    if not actor.is_superuser:
        raise AdminUserActionError("Only superusers can modify staff status.", 403)
    if not isinstance(is_staff, bool):
        raise AdminUserActionError("is_staff must be true or false.", 400)
    if target_user.pk == actor.pk:
        raise AdminUserActionError("Cannot modify your own staff status.", 400)

    previous = target_user.is_staff
    if previous != is_staff:
        target_user.is_staff = is_staff
        target_user.save(update_fields=["is_staff"])
        record_admin_action(
            request,
            action=AuditLog.ActionType.UPDATE,
            entity_type="User",
            entity_id=target_user.pk,
            entity_repr=target_user.username,
            previous={"is_staff": previous},
            new={"is_staff": is_staff},
        )
    else:
        mark_nothing_to_audit(request)

    return AdminUserActionResult(
        payload={
            "id": target_user.pk,
            "username": target_user.username,
            "is_staff": target_user.is_staff,
            "message": f"User {'promoted to' if is_staff else 'removed from'} staff.",
        },
        status_code=200,
    )


def delete_user_account(request, target_user) -> AdminUserActionResult:
    actor = request.user
    if not actor.is_superuser:
        raise AdminUserActionError("Only superusers can delete users.", 403)
    if target_user.pk == actor.pk:
        raise AdminUserActionError("Cannot delete your own account through admin.", 400)
    if target_user.is_superuser:
        raise AdminUserActionError("Cannot delete superuser accounts.", 403)

    username = target_user.username
    user_id = target_user.pk
    with transaction.atomic():
        target_user.delete()
        record_admin_action(
            request,
            action=AuditLog.ActionType.DELETE,
            entity_type="User",
            entity_id=user_id,
            entity_repr=username,
            previous={"username": username, "is_staff": target_user.is_staff},
        )

    return AdminUserActionResult(
        payload={"message": f"User '{username}' deleted successfully."},
        status_code=200,
    )


def moderation_history(user_id: int) -> list[dict]:
    """The last audit rows about this user, including bulk ban/unban rows that changed them."""
    rows = (
        AuditLog.objects.filter(entity_type="User")
        .filter(
            Q(entity_id=str(user_id))
            | Q(action=AuditLog.ActionType.BULK_ACTION, metadata__changed_ids__contains=[user_id])
        )
        .select_related("user")
        .order_by("-timestamp")[:MODERATION_HISTORY_LIMIT]
    )
    return [
        {
            "id": row.id,
            "action": row.action,
            "entity_type": row.entity_type,
            "timestamp": row.timestamp.isoformat(),
            "actor": row.user.username if row.user else None,
            "reason": (row.metadata or {}).get("reason", ""),
            "changes": row.changes,
        }
        for row in rows
    ]
