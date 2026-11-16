"""One audit row per staff action (G6 contract, overview section 5).

Admin views and other groups' staff-only actions (G5 moderation, badge rules) call
``record_admin_action`` instead of creating ``AuditLog`` rows themselves. It writes
the row synchronously (admin mutations are rare), takes the client IP from
``core.utils.get_client_ip`` and marks the request, so ``AdminAuditMiddleware``'s
generic fallback row is skipped for it. Call it only after the action succeeded.
"""

from __future__ import annotations

from typing import Any

from ...core.models import AuditLog
from ...core.utils import get_client_ip

ENTITY_REPR_MAX_LENGTH = 200
AUDITED_FLAG = "_admin_audited"


def mark_audited(request) -> None:
    """Flag the request as audited, on the DRF wrapper and the Django request it wraps."""
    setattr(request, AUDITED_FLAG, True)
    django_request = getattr(request, "_request", None)
    if django_request is not None:
        setattr(django_request, AUDITED_FLAG, True)


def mark_nothing_to_audit(request) -> None:
    """A successful request that changed nothing (a repeat, a dry run): no fallback row."""
    mark_audited(request)


def is_audited(request) -> bool:
    return bool(getattr(request, AUDITED_FLAG, False))


def record_admin_action(
    request,
    *,
    action,
    entity_type,
    entity_id="",
    entity_repr="",
    previous=None,
    new=None,
    metadata=None,
    reason="",
) -> AuditLog:
    """Write and return the ``AuditLog`` row for one staff action."""
    row_metadata: dict[str, Any] = dict(metadata or {})
    if reason:
        row_metadata["reason"] = reason
    user = getattr(request, "user", None)
    entry = AuditLog.objects.create(
        user=user if getattr(user, "is_authenticated", False) else None,
        user_ip=get_client_ip(request),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else "",
        entity_repr=str(entity_repr)[:ENTITY_REPR_MAX_LENGTH],
        previous_state=previous or {},
        new_state=new or {},
        metadata=row_metadata,
    )
    mark_audited(request)
    return entry
