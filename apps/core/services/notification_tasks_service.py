"""Notification task logic (G4 Notifications), moved out of ``CoreTaskService``.

``apps.core.tasks.notifications`` calls this. ``CoreTaskService`` keeps one-line
delegating methods with the old names, so older call sites keep working.
"""

from __future__ import annotations

from ...shared.logger import logger
from . import episode_notifications, notification_delivery
from .notification_service import NotificationService

# Kept for importers of the old module constant.
NEW_EPISODE_LOOKBACK_HOURS = episode_notifications.NEW_EPISODE_LOOKBACK_HOURS


class NotificationTaskService:
    """Service methods behind the notification Celery tasks."""

    @staticmethod
    def send_pending_notifications() -> dict:
        """Sweeper: deliver what the event-driven path missed (2 min to 24 h old)."""
        result = notification_delivery.sweep_pending()
        logger.info("Processed pending notifications", extra=result)
        return result

    @staticmethod
    def deliver_notifications(notification_ids: list[int]) -> dict:
        return notification_delivery.deliver(notification_ids)

    @staticmethod
    def check_new_episodes() -> dict:
        return episode_notifications.check_new_episodes()

    @staticmethod
    def cleanup_old_notifications(
        days: int = 90, unread_days: int = 180, batch_size: int = 5000
    ) -> dict:
        deleted = NotificationService.cleanup_old_notifications(
            days=days, unread_days=unread_days, batch_size=batch_size
        )
        result = {"deleted": deleted, "days": days, "unread_days": unread_days}
        logger.info("Cleaned up old notifications", extra=result)
        return result
