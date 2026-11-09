"""Celery task wrappers for notification delivery and cleanup."""

from __future__ import annotations

from ...shared.celery import observed_shared_task
from ...shared.logger import logger
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
        try:
            return CoreTaskService.send_pending_notifications()
        except Exception as exc:
            logger.exception("Pending notification delivery task failed")
            raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard")
def check_new_episodes(self):
    with cache_lock("notifications:new-episodes:lock", timeout=NOTIFICATION_TASK_LOCK_SECONDS) as acquired:
        if not acquired:
            return {"status": "skipped", "reason": "already_running"}
        try:
            return CoreTaskService.check_new_episodes()
        except Exception as exc:
            logger.exception("New episode notification scan failed")
            raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard")
def cleanup_old_notifications_task(self, days: int = 90):
    try:
        return CoreTaskService.cleanup_old_notifications(days=days)
    except Exception as exc:
        logger.exception("Notification cleanup task failed", extra={"days": days})
        raise self.retry(exc=exc)
