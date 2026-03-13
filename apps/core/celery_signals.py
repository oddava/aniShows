from celery.signals import (
    task_failure,
    task_prerun,
    task_retry,
    task_revoked,
    task_success,
    worker_ready,
)
from django.utils import timezone

from apps.shared.logger import logger


@task_prerun.connect
def on_task_prerun(task_id, task, args, kwargs, **extra_kwargs):
    from apps.core.models import CeleryTaskResult

    try:
        task_name = getattr(task, "name", "unknown")
        # Handle cases where the view already created a PENDING result
        job, created = CeleryTaskResult.objects.get_or_create(
            task_id=task_id,
            defaults={
                "task_name": task_name,
                "status": CeleryTaskResult.TaskStatus.STARTED,
                "date_started": timezone.now(),
                "task_args": list(args) if args else [],
                "task_kwargs": dict(kwargs) if kwargs else {},
            },
        )
        if not created:
            job.status = CeleryTaskResult.TaskStatus.STARTED
            job.date_started = timezone.now()
            # If the task was triggered elsewhere, populate its name just in case
            if not job.task_name:
                job.task_name = task_name
            # Also populate args/kwargs if not already set (for celery beat tasks)
            if not job.task_args and args:
                job.task_args = list(args)
            if not job.task_kwargs and kwargs:
                job.task_kwargs = dict(kwargs)
            job.save(
                update_fields=["status", "date_started", "task_name", "task_args", "task_kwargs"]
            )
    except Exception as e:
        logger.error(f"Error in task_prerun signal for task {task_id}: {e}")


@task_success.connect
def on_task_success(sender=None, result=None, **kwargs):
    from apps.core.models import CeleryTaskResult

    task_id = sender.request.id if sender and hasattr(sender, "request") else kwargs.get("task_id")
    if task_id:
        try:
            job = CeleryTaskResult.objects.get(task_id=task_id)
            job.status = CeleryTaskResult.TaskStatus.SUCCESS

            # Make sure result is JSON serializable
            if isinstance(result, (dict, list, str, int, float, bool, type(None))):
                job.result_data = result
            else:
                job.result_data = {"result": str(result)}

            job.date_completed = timezone.now()

            if job.date_started:
                job.execution_time = (job.date_completed - job.date_started).total_seconds()

            job.save(update_fields=["status", "result_data", "date_completed", "execution_time"])
        except CeleryTaskResult.DoesNotExist:
            logger.warning(f"CeleryTaskResult not found for task_success (id: {task_id})")
        except Exception as e:
            logger.error(f"Error in task_success signal for task {task_id}: {e}")


@task_failure.connect
def on_task_failure(task_id, exception, traceback, **kwargs):
    from apps.core.models import CeleryTaskResult

    try:
        job = CeleryTaskResult.objects.get(task_id=task_id)
        job.status = CeleryTaskResult.TaskStatus.FAILURE
        job.error_message = str(exception)
        job.traceback = str(traceback)
        job.date_completed = timezone.now()

        if job.date_started:
            job.execution_time = (job.date_completed - job.date_started).total_seconds()

        job.save(
            update_fields=[
                "status",
                "error_message",
                "traceback",
                "date_completed",
                "execution_time",
            ]
        )
    except Exception as e:
        logger.error(f"Error in task_failure signal for task {task_id}: {e}")


@task_retry.connect
def on_task_retry(request, reason, einfo, **kwargs):
    from apps.core.models import CeleryTaskResult

    try:
        job = CeleryTaskResult.objects.get(task_id=request.id)
        job.status = CeleryTaskResult.TaskStatus.RETRY
        job.retries += 1
        job.error_message = f"Retrying: {reason}"
        job.save(update_fields=["status", "retries", "error_message"])
    except Exception as e:
        logger.error(f"Error in task_retry signal for task {request.id}: {e}")

    # Emit Prometheus retry metric
    try:
        from apps.animes.services.metrics import TASK_RETRY_COUNT

        task_name = getattr(request, "task", "unknown") if hasattr(request, "task") else "unknown"
        TASK_RETRY_COUNT.labels(task_name=task_name).inc()
    except Exception:
        pass


@task_revoked.connect
def on_task_revoked(request, terminated, signum, expired, **kwargs):
    from apps.core.models import CeleryTaskResult

    task_id = request.id if hasattr(request, "id") else request.task_id
    try:
        job = CeleryTaskResult.objects.get(task_id=task_id)
        job.status = CeleryTaskResult.TaskStatus.REVOKED
        job.error_message = "Task revoked/terminated"
        job.date_completed = timezone.now()

        if job.date_started:
            job.execution_time = (job.date_completed - job.date_started).total_seconds()

        job.save(update_fields=["status", "error_message", "date_completed", "execution_time"])
    except Exception as e:
        logger.error(f"Error in task_revoked signal for task {task_id}: {e}")


@worker_ready.connect
def start_queue_monitor(sender, **kwargs):
    """Start periodic queue size monitoring when worker is ready."""
    import threading

    def monitor_queue_sizes():
        import time

        from django.core.cache import cache

        from apps.animes.services.metrics import update_queue_size

        queue_names = [
            "critical",
            "high_priority",
            "default",
            "batch",
            "images",
            "notifications",
            "analytics",
            "low_priority",
        ]

        while True:
            try:
                for queue_name in queue_names:
                    try:
                        redis_client = cache.client.get_client()
                        size = redis_client.llen(queue_name)
                        update_queue_size(queue_name, size)
                    except Exception:
                        pass
            except Exception:
                pass
            time.sleep(15)  # Update every 15 seconds (matches Prometheus scrape interval)

    thread = threading.Thread(target=monitor_queue_sizes, daemon=True)
    thread.start()
    logger.info("Started Prometheus queue size monitor thread")
