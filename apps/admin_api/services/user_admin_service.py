"""Staff actions on user accounts: suspend, restore, staff flag, delete (G6 P1-2).

Suspending sets ``is_active=False`` and ends every session through G1's
``revoke_all_sessions`` (refresh tokens blacklisted; inactive users' access tokens
are refused by simplejwt). The reason lives in the ``AuditLog`` row, so
``CustomUser`` needs no new field. Each change writes exactly one audit row; a
repeated suspend or restore is a no-op that writes none.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass

from django.core.cache import cache
from django.db import transaction
from django.db.models import Q

from ...core.models import AuditLog
from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from ...users.models import UserProfile
from ...users.services.auth_service import revoke_all_sessions
from ...users.services.cache import invalidate_user_caches
from ...users.services.email_service import EmailService
from ...users.services.profile_update_service import delete_files_on_commit
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


def check_can_moderate(target_user, actor, verb: str = "suspend or restore") -> None:
    """Refuse acting on yourself, on a superuser, and (unless superuser) on staff."""
    if target_user.pk == actor.pk:
        raise AdminUserActionError(f"You cannot {verb} your own account.", 400)
    if target_user.is_superuser:
        raise AdminUserActionError(f"You cannot {verb} a superuser account.", 403)
    if target_user.is_staff and not actor.is_superuser:
        raise AdminUserActionError(f"Only superusers can {verb} staff accounts.", 403)


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


def _lock_user(target_user):
    """Re-read the target under a row lock, so checks and changes see its current state.

    Without it a staff moderator could suspend an account a superuser promoted a moment
    earlier, and two concurrent suspends would both report (and audit) a change. Call it
    inside the caller's transaction: the lock lasts until that transaction ends (outside
    one, ``select_for_update`` raises ``TransactionManagementError``).
    """
    return type(target_user)._default_manager.select_for_update().get(pk=target_user.pk)


@transaction.atomic
def _set_active_and_audit(request, target_user, *, active: bool, raw_reason) -> dict:
    actor = request.user
    target_user = _lock_user(target_user)
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

    target_user = _lock_user(target_user)
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
            "operation": (row.metadata or {}).get("operation", ""),
            "changes": row.changes,
        }
        for row in rows
    ]


CLEARABLE_PROFILE_FIELDS = ("bio", "avatar", "banner")


@transaction.atomic
def revoke_user_sessions(request, target_user) -> AdminUserActionResult:
    """Sign the user out everywhere (refresh tokens blacklisted), audited."""
    target_user = _lock_user(target_user)
    check_can_moderate(target_user, request.user, "sign out")
    revoke_all_sessions(target_user)
    record_admin_action(
        request,
        action=AuditLog.ActionType.CONTROL,
        entity_type="User",
        entity_id=target_user.pk,
        entity_repr=target_user.username,
        metadata={"operation": "revoke_sessions"},
    )
    return AdminUserActionResult(
        payload={"id": target_user.pk, "message": "Signed out of every session."},
        status_code=200,
    )


@transaction.atomic
def verify_user_email(request, target_user) -> AdminUserActionResult:
    target_user = _lock_user(target_user)
    profile, _ = UserProfile.objects.select_for_update().get_or_create(user=target_user)
    changed = not profile.email_verified
    if changed:
        profile.email_verified = True
        profile.save(update_fields=["email_verified"])
        record_admin_action(
            request,
            action=AuditLog.ActionType.UPDATE,
            entity_type="User",
            entity_id=target_user.pk,
            entity_repr=target_user.username,
            previous={"email_verified": False},
            new={"email_verified": True},
        )
        transaction.on_commit(lambda: invalidate_user_caches(target_user.pk, target_user.username))
    else:
        mark_nothing_to_audit(request)
    return AdminUserActionResult(
        payload={
            "id": target_user.pk,
            "email_verified": True,
            "changed": changed,
            "message": "Email marked as verified." if changed else "Email was already verified.",
        },
        status_code=200,
    )


PASSWORD_RESET_COOLDOWN_SECONDS = 10 * 60
PASSWORD_RESET_COOLDOWN_KEY = "admin:password-reset-sent:{user_id}"


def _claim_password_reset_slot(user_id) -> bool:
    """One admin-sent reset per account per cooldown, so the action cannot spam anyone."""
    try:
        return bool(
            cache.add(
                PASSWORD_RESET_COOLDOWN_KEY.format(user_id=user_id),
                1,
                timeout=PASSWORD_RESET_COOLDOWN_SECONDS,
            )
        )
    except CACHE_ERRORS:
        return True


def send_user_password_reset(request, target_user) -> AdminUserActionResult:
    """Email the normal reset link (the same one "Forgot password" sends)."""
    check_can_moderate(target_user, request.user, "send a password reset to")
    if not target_user.is_active:
        raise AdminUserActionError("This account is suspended.", 400)
    if not (target_user.email or "").strip():
        raise AdminUserActionError("This account has no email address.", 400)
    if not _claim_password_reset_slot(target_user.pk):
        raise AdminUserActionError(
            "A reset email went to this account in the last 10 minutes. Try again later.", 429
        )
    try:
        EmailService().send_password_reset_email(target_user)
    except ENQUEUE_ERRORS:
        logger.exception(
            "Queueing an admin password reset failed", extra={"user_id": target_user.pk}
        )
        with suppress(*CACHE_ERRORS):
            cache.delete(PASSWORD_RESET_COOLDOWN_KEY.format(user_id=target_user.pk))
        raise AdminUserActionError(
            "The email could not be queued. Try again shortly.", 503
        ) from None
    record_admin_action(
        request,
        action=AuditLog.ActionType.TRIGGER,
        entity_type="User",
        entity_id=target_user.pk,
        entity_repr=target_user.username,
        metadata={"operation": "send_password_reset"},
    )
    return AdminUserActionResult(
        payload={"id": target_user.pk, "message": "Password reset email queued."},
        status_code=200,
    )


def _clean_profile_fields(raw) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise AdminUserActionError(
            f"fields must be a non-empty list of: {', '.join(CLEARABLE_PROFILE_FIELDS)}.", 400
        )
    if any(field not in CLEARABLE_PROFILE_FIELDS for field in raw):
        raise AdminUserActionError(
            f"fields must be a non-empty list of: {', '.join(CLEARABLE_PROFILE_FIELDS)}.", 400
        )
    return [field for field in CLEARABLE_PROFILE_FIELDS if field in raw]


@transaction.atomic
def clear_user_profile(request, target_user, raw_fields, raw_reason) -> AdminUserActionResult:
    """Clear offensive profile content (bio, avatar, banner); stored files go after commit."""
    fields = _clean_profile_fields(raw_fields)
    target_user = _lock_user(target_user)
    check_can_moderate(target_user, request.user, "moderate")
    reason = clean_reason(raw_reason)
    profile, _ = UserProfile.objects.select_for_update().get_or_create(user=target_user)

    previous: dict = {}
    old_files = []
    for field in fields:
        if field == "bio":
            if profile.bio:
                previous["bio"] = profile.bio[:500]
                profile.bio = ""
        else:
            stored = getattr(profile, field)
            if stored and stored.name:
                previous[field] = stored.name
                old_files.append(stored)
                setattr(profile, field, None)

    changed = sorted(previous)
    if changed:
        profile.save(update_fields=changed)
        delete_files_on_commit(old_files)
        record_admin_action(
            request,
            action=AuditLog.ActionType.UPDATE,
            entity_type="User",
            entity_id=target_user.pk,
            entity_repr=target_user.username,
            previous=previous,
            new=dict.fromkeys(changed, ""),
            metadata={"operation": "clear_profile"},
            reason=reason,
        )
        transaction.on_commit(lambda: invalidate_user_caches(target_user.pk, target_user.username))
    else:
        mark_nothing_to_audit(request)
    return AdminUserActionResult(
        payload={
            "id": target_user.pk,
            "cleared": changed,
            "message": "Profile content cleared." if changed else "Nothing to clear.",
        },
        status_code=200,
    )
