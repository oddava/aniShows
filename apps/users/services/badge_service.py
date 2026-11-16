"""Badge grants and featured badges (G5 contract, overview section 5).

Prep-commit stub: ``grant_badge``/``revoke_badge`` do for one user what
``AdminBadgeViewSet.grant``/``revoke`` do today (create or delete the row, send the
``badge_awarded`` notification, invalidate the user's caches), without the audit row:
admin callers audit through ``apps.admin_api.services.audit.record_admin_action``.
Nothing calls them yet; G6 switches the admin views to them. G5 owns this module.
"""

from ...core.services.notification_service import NotificationService
from ...shared.logger import logger
from ..models import UserBadge
from .cache import invalidate_user_caches

# How many badges a user may feature on their profile (enforced in the badges view
# today; ``BadgesMixin`` shows the first three).
MAX_FEATURED_BADGES = 3


def grant_badge(user, badge, granted_by=None, reason: str = "") -> UserBadge | None:
    """Grant ``badge`` to ``user``. Return the new grant, or ``None`` if they already hold it."""
    user_badge, created = UserBadge.objects.get_or_create(
        user=user,
        badge=badge,
        defaults={"granted_by": granted_by, "reason": reason},
    )
    if not created:
        return None
    try:
        NotificationService.create_badge_awarded_notification(
            user=user, badge=badge, granted_by=granted_by
        )
    except Exception:
        # The badge is granted; a notification failure must not undo that.
        logger.exception("Could not send badge notification")
    invalidate_user_caches(user.id, user.username, trigger_stats_update=False)
    return user_badge


def revoke_badge(user, badge) -> bool:
    """Take ``badge`` away from ``user``. Return whether they held it."""
    deleted, _ = UserBadge.objects.filter(user=user, badge=badge).delete()
    invalidate_user_caches(user.id, user.username, trigger_stats_update=False)
    return deleted > 0
