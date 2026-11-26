"""Celery task wrappers for notification delivery and cleanup."""

from __future__ import annotations

from ...shared.celery import observed_shared_task, retry_on_error
from ...shared.task_lock import cache_lock
from ..services.announcement_service import broadcast_announcement
from ..services.notification_tasks_service import NotificationTaskService

# Overlapping runs would deliver (or create) the same notifications twice.
# The lock outlives the task's hard time limit.
NOTIFICATION_TASK_LOCK_SECONDS = 15 * 60


@observed_shared_task(retry_policy="standard", queue="notifications")
def deliver_notifications(self, notification_ids: list[int]):
    """Event-driven push/email delivery, enqueued by ``notify`` on commit.

    Each channel is claimed per row before sending, so no lock is needed: a race
    with the sweeper or a retry never delivers twice.
    """
    with retry_on_error(
        self, "Notification delivery task failed", extra={"count": len(notification_ids)}
    ):
        return NotificationTaskService.deliver_notifications(notification_ids)


@observed_shared_task(retry_policy="standard")
def send_pending_notifications(self):
    with cache_lock(
        "notifications:send-pending:lock", timeout=NOTIFICATION_TASK_LOCK_SECONDS
    ) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "already_running"}
        with retry_on_error(self, "Pending notification delivery task failed"):
            return NotificationTaskService.send_pending_notifications()


@observed_shared_task(retry_policy="standard")
def check_new_episodes(self):
    with cache_lock(
        "notifications:new-episodes:lock", timeout=NOTIFICATION_TASK_LOCK_SECONDS
    ) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "already_running"}
        with retry_on_error(self, "New episode notification scan failed"):
            return NotificationTaskService.check_new_episodes()


@observed_shared_task(retry_policy="standard")
def cleanup_old_notifications_task(self, days: int = 90):
    with retry_on_error(self, "Notification cleanup task failed", extra={"days": days}):
        return NotificationTaskService.cleanup_old_notifications(days=days)


@observed_shared_task(retry_policy="standard", queue="notifications")
def broadcast_announcement_task(self, announcement_id: int, audience: str = "all"):
    """In-app notice of an announcement to an audience (admin "Notify users")."""
    with retry_on_error(
        self, "Announcement broadcast failed", extra={"announcement_id": announcement_id}
    ):
        return broadcast_announcement(announcement_id, audience)
