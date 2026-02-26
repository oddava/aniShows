"""
Core Celery tasks for system maintenance and monitoring.

Provides:
- Task result cleanup
- System health checks
- Maintenance workflows
"""

import logging
from datetime import datetime, timedelta
from celery import shared_task
from django.utils import timezone
from django.conf import settings

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    time_limit=1800,  # 30 minutes max
    soft_time_limit=1500,
)
def cleanup_old_task_results(self, days=7, batch_size=1000):
    """
    Clean up old Celery task results from database.

    Removes task results older than specified days to prevent database bloat.
    Processes in batches to avoid locking tables for too long.

    Args:
        days: Delete results older than this many days (default: 7)
        batch_size: Number of records to delete per batch (default: 1000)

    Returns:
        dict: Statistics about cleanup operation
    """
    from apps.core.models import CeleryTaskResult

    try:
        cutoff_date = timezone.now() - timedelta(days=days)

        # Get count of records to delete
        old_results = CeleryTaskResult.objects.filter(date_created__lt=cutoff_date)
        total_to_delete = old_results.count()

        if total_to_delete == 0:
            logger.info("No old task results to cleanup")
            return {"deleted": 0, "total_found": 0}

        logger.info(f"Found {total_to_delete} task results older than {days} days")

        # Delete in batches
        deleted_total = 0
        batches = 0

        while True:
            # Get IDs for this batch
            batch_ids = list(
                CeleryTaskResult.objects.filter(date_created__lt=cutoff_date).values_list(
                    "id", flat=True
                )[:batch_size]
            )

            if not batch_ids:
                break

            # Delete this batch
            deleted_count = CeleryTaskResult.objects.filter(id__in=batch_ids).delete()[0]
            deleted_total += deleted_count
            batches += 1

            logger.info(f"Batch {batches}: Deleted {deleted_count} task results")

            # Break if we got fewer than batch_size (no more records)
            if len(batch_ids) < batch_size:
                break

        logger.info(f"Cleanup complete. Deleted {deleted_total} task results in {batches} batches")

        return {
            "deleted": deleted_total,
            "total_found": total_to_delete,
            "batches": batches,
            "days_threshold": days,
        }

    except Exception as e:
        logger.error(f"Error cleaning up task results: {e}")
        raise self.retry(exc=e)


@shared_task
def cleanup_celery_backend(days=1):
    """
    Clean up Celery result backend (Redis).

    Note: Redis results expire automatically based on result_expires setting,
    but this task can force cleanup if needed.

    Args:
        days: Clean results older than this many days

    Returns:
        dict: Cleanup status
    """
    # Redis results are automatically expired by Celery
    # This task serves as a placeholder for custom backend cleanup if needed
    logger.info("Redis result backend cleanup skipped - handled automatically by Celery")
    return {"status": "skipped", "reason": "automatic_cleanup_enabled"}


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    time_limit=300,  # 5 minutes
)
def health_check_workers(self):
    """
    Check health of Celery workers and alert if any are down.

    Returns:
        dict: Health status of all workers
    """
    from apps.core.models import CeleryWorkerStatus

    try:
        # Get all workers and their last heartbeat
        timeout_threshold = timezone.now() - timedelta(minutes=5)

        workers = CeleryWorkerStatus.objects.all()
        status_report = {
            "total_workers": workers.count(),
            "healthy": 0,
            "unhealthy": 0,
            "details": [],
        }

        for worker in workers:
            is_healthy = worker.last_heartbeat and worker.last_heartbeat > timeout_threshold

            worker_info = {
                "name": worker.worker_name,
                "hostname": worker.hostname,
                "healthy": is_healthy,
                "last_heartbeat": worker.last_heartbeat.isoformat()
                if worker.last_heartbeat
                else None,
                "processed_count": worker.processed_tasks,
                "failed_count": worker.failed_tasks,
            }

            status_report["details"].append(worker_info)

            if is_healthy:
                status_report["healthy"] += 1
            else:
                status_report["unhealthy"] += 1
                logger.warning(f"Worker {worker.worker_name} appears unhealthy")

        if status_report["unhealthy"] > 0:
            logger.warning(f"Health check found {status_report['unhealthy']} unhealthy workers")
        else:
            logger.info(f"All {status_report['healthy']} workers are healthy")

        return status_report

    except Exception as e:
        logger.error(f"Error in worker health check: {e}")
        raise self.retry(exc=e)
