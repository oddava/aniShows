"""Core Celery task wrappers for maintenance and monitoring."""

from __future__ import annotations

from ...shared.celery import observed_shared_task, retry_on_error
from ..services.celery_tasks import CoreTaskService


@observed_shared_task(retry_policy="standard", time_limit_preset="standard")
def cleanup_old_task_results(self, days: int = 7, batch_size: int = 1000):
    with retry_on_error(
        self,
        "Custom Celery task result cleanup failed",
        extra={"days": days, "batch_size": batch_size},
    ):
        return CoreTaskService.cleanup_old_task_results(days=days, batch_size=batch_size)


@observed_shared_task(retry_policy="none")
def cleanup_celery_backend(self, days: int = 1):
    return CoreTaskService.cleanup_celery_backend(days=days)


@observed_shared_task(retry_policy="quick", time_limit_preset="quick")
def health_check_workers(self):
    with retry_on_error(self, "Celery worker health check failed", countdown=30):
        return CoreTaskService.health_check_workers()


@observed_shared_task(retry_policy="quick", time_limit_preset="quick")
def flush_forum_view_counts(self, max_threads: int | None = None):
    with retry_on_error(
        self, "Forum view flush failed", extra={"max_threads": max_threads}, countdown=30
    ):
        return CoreTaskService.flush_forum_view_counts(max_threads=max_threads)


@observed_shared_task(retry_policy="quick", time_limit_preset="quick")
def collect_queue_metrics(self):
    with retry_on_error(self, "Queue metric collection failed", countdown=30):
        return CoreTaskService.collect_queue_metrics()
