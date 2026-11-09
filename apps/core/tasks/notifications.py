"""Celery task wrappers for notification delivery and cleanup."""

from __future__ import annotations

from ...shared.celery import observed_shared_task, retry_on_error
from ...shared.task_lock import cache_lock
from ..services.celery_tasks import CoreTaskService

# Overlapping runs would deliver (or create) the same notifications twice.
# The lock outlives the task's hard time limit.
NOTIFICATION_TASK_LOCK_SECONDS = 15 * 60


@observed_shared_task(retry_policy="standard")
def send_pending_notifications(self):
    with cache_lock("notifications:send-pending:lock", timeout=NOTIFICATION_TASK_LOCK_SECONDS) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "already_running"}
        with retry_on_error(self, "Pending notification delivery task failed"):
            return CoreTaskService.send_pending_notifications()


@observed_shared_task(retry_policy="standard")
def check_new_episodes(self):
    with cache_lock("notifications:new-episodes:lock", timeout=NOTIFICATION_TASK_LOCK_SECONDS) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "already_running"}
        with retry_on_error(self, "New episode notification scan failed"):
            return CoreTaskService.check_new_episodes()


@observed_shared_task(retry_policy="standard")
def cleanup_old_notifications_task(self, days: int = 90):
    with retry_on_error(self, "Notification cleanup task failed", extra={"days": days}):
        return CoreTaskService.cleanup_old_notifications(days=days)
