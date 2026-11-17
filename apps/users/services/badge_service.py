"""Badge grants and featured badges (G5 contract, overview section 5).

``grant_badge``/``revoke_badge`` create or delete one grant, send the ``badge_awarded``
notification and invalidate the user's caches. They write no audit row: admin callers
audit through ``apps.admin_api.services.audit.record_admin_action``.
``set_featured_badges`` is the user-facing choice of badges shown on the profile.
"""

from django.db import transaction
from django.db.models import Case, Value, When
from rest_framework.exceptions import ValidationError

from ...core.services.notification_service import notify
from ..models import UserBadge
from .cache import invalidate_user_caches

# How many badges a user may feature on their profile (``BadgesMixin`` shows this many).
MAX_FEATURED_BADGES = 3


def _invalidate(user) -> None:
    invalidate_user_caches(user.id, user.username, trigger_stats_update=False)


def grant_badge(user, badge, granted_by=None, reason: str = "") -> UserBadge | None:
    """Grant ``badge`` to ``user``. Return the new grant, or ``None`` if they already hold it."""
    user_badge, created = UserBadge.objects.get_or_create(
        user=user,
        badge=badge,
        defaults={"granted_by": granted_by, "reason": reason},
    )
    if not created:
        return None
    # notify() never raises: a notification failure cannot undo the grant.
    notify(
        user,
        "badge_awarded",
        actor=granted_by,
        data={"badge_id": badge.id},
        dedupe_key=f"badge:{badge.id}",
    )
    _invalidate(user)
    return user_badge


def revoke_badge(user, badge) -> bool:
    """Take ``badge`` away from ``user``. Return whether they held it."""
    deleted, _ = UserBadge.objects.filter(user=user, badge=badge).delete()
    if deleted:
        _invalidate(user)
    return deleted > 0


def _validate_featured_ids(badge_ids: object) -> list[int]:
    if not isinstance(badge_ids, list) or not all(
        isinstance(badge_id, int) and not isinstance(badge_id, bool) for badge_id in badge_ids
    ):
        raise ValidationError({"badge_ids": "Please provide a list of user_badge ids."})
    if len(set(badge_ids)) != len(badge_ids):
        raise ValidationError({"badge_ids": "Each badge can be featured only once."})
    if len(badge_ids) > MAX_FEATURED_BADGES:
        raise ValidationError(
            {"badge_ids": f"You can feature a maximum of {MAX_FEATURED_BADGES} badges."}
        )
    return badge_ids


def set_featured_badges(user, badge_ids: object) -> list[UserBadge]:
    """Feature exactly ``badge_ids`` (the user's own grants of active badges).

    Raises ``ValidationError`` for anything else and changes nothing in that case.
    Returns the featured grants, newest first.
    """
    ids = set(_validate_featured_ids(badge_ids))
    with transaction.atomic():
        grants = list(
            UserBadge.objects.select_for_update(of=("self",))
            .filter(user=user)
            .select_related("badge")
        )
        usable = {grant.id for grant in grants if grant.badge.is_active}
        if not ids <= usable:
            raise ValidationError({"badge_ids": "You can only feature active badges you own."})
        UserBadge.objects.filter(user=user).update(
            is_featured=Case(When(id__in=ids, then=Value(True)), default=Value(False))
        )
    _invalidate(user)
    featured = [grant for grant in grants if grant.id in ids]
    for grant in featured:
        grant.is_featured = True
    return featured
