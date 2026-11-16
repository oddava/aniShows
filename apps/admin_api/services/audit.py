"""One audit row per staff action (G6 contract, overview section 5).

Admin views and other groups' staff-only actions (G5 moderation, badge rules) call
``record_admin_action`` instead of creating ``AuditLog`` rows themselves.

Prep-commit stub: it writes the same ``AuditLog`` row the badge views write today,
taking the client IP from ``core.utils.get_client_ip``, and marks the request so
G6's middleware fallback (P0-1) can skip it. Nothing calls it yet. G6 owns it.
"""

from ...core.models import AuditLog
from ...core.utils import get_client_ip

ENTITY_REPR_MAX_LENGTH = 200


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
    row_metadata = dict(metadata or {})
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
    request._admin_audited = True
    return entry
