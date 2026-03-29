"""Celery task wrappers for notification delivery and cleanup."""

from __future__ import annotations

import logging

from apps.core.services.celery_tasks import CoreTaskService
from apps.shared.celery import observed_shared_task

logger = logging.getLogger(__name__)


@observed_shared_task(retry_policy="standard")
def send_pending_notifications(self):
    try:
        return CoreTaskService.send_pending_notifications()
    except Exception as exc:
        logger.exception("Pending notification delivery task failed")
        raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard")
def check_new_episodes(self):
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
