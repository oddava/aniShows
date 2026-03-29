"""Core Celery task wrappers for maintenance and monitoring."""

from __future__ import annotations

import logging

from apps.core.services.celery_tasks import CoreTaskService
from apps.shared.celery import observed_shared_task

logger = logging.getLogger(__name__)


@observed_shared_task(retry_policy="standard", time_limit_preset="standard")
def cleanup_old_task_results(self, days: int = 7, batch_size: int = 1000):
    try:
        return CoreTaskService.cleanup_old_task_results(days=days, batch_size=batch_size)
    except Exception as exc:
        logger.exception(
            "Custom Celery task result cleanup failed",
            extra={"days": days, "batch_size": batch_size},
        )
        raise self.retry(exc=exc)


@observed_shared_task(retry_policy="none")
def cleanup_celery_backend(self, days: int = 1):
    return CoreTaskService.cleanup_celery_backend(days=days)


@observed_shared_task(retry_policy="quick", time_limit_preset="quick")
def health_check_workers(self):
    try:
        return CoreTaskService.health_check_workers()
    except Exception as exc:
        logger.exception("Celery worker health check failed")
        raise self.retry(exc=exc, countdown=30)


@observed_shared_task(retry_policy="quick", time_limit_preset="quick")
def flush_forum_view_counts(self, max_threads: int | None = None):
    try:
        return CoreTaskService.flush_forum_view_counts(max_threads=max_threads)
    except Exception as exc:
        logger.exception("Forum view flush failed", extra={"max_threads": max_threads})
        raise self.retry(exc=exc, countdown=30)
