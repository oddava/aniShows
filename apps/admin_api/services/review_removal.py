"""Telling a member their review was taken down, and why."""

from __future__ import annotations

from django.db import transaction

from ...core.services.notification_service import NotificationService
from ...shared.logger import logger

TITLE_MAX = 200


def notify_review_removed(review, reason: str) -> None:
    """After commit, send the author an in-app notice naming the review and the reason.

    Best effort: a failed notice never undoes the removal.
    """
    user = review.user
    anime_title = review.anime.title
    anime_slug = review.anime.slug

    def send():
        try:
            NotificationService.create_notification(
                user,
                "system",
                title=f"Your review of {anime_title} was removed"[:TITLE_MAX],
                message=f"A moderator removed it. Reason: {reason}",
                data={"url": f"/anime/{anime_slug}", "reason": reason},
            )
        except Exception:
            logger.exception("Could not notify a review author", extra={"user_id": user.pk})

    transaction.on_commit(send)
