import os
from contextlib import suppress
from pathlib import Path

from celery.signals import (
    celeryd_init,
    task_failure,
    task_prerun,
    task_retry,
    task_revoked,
    task_success,
    worker_ready,
)
from django.utils import timezone

from ..shared.logger import logger
from .db_safety import (
    is_missing_relation_error,
    model_table_exists,
    warn_missing_table_once,
)


@celeryd_init.connect
def clean_multiproc_dir(sender, instance, **kwargs):
    """Clean up the multiprocess metrics directory before worker starts."""
    path = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if path:
        multiproc_dir = Path(path)
        if not multiproc_dir.exists():
            multiproc_dir.mkdir(parents=True, exist_ok=True)
        else:
            for db_file in multiproc_dir.glob("*.db"):
                with suppress(OSError):
                    db_file.unlink()


@task_prerun.connect
def on_task_prerun(task_id, task, args, kwargs, **extra_kwargs):
    from .models import CeleryTaskResult

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task pre-run tracking",
        )
        return

    try:
        task_name = getattr(task, "name", "unknown")
        # Handle cases where the view already created a PENDING result
        job, created = CeleryTaskResult.objects.using("default").get_or_create(
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
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task pre-run tracking",
            )
            return
        logger.error(f"Error in task_prerun signal for task {task_id}: {e}")


@task_success.connect
def on_task_success(sender=None, result=None, **kwargs):
    from .models import CeleryTaskResult

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task success tracking",
        )
        return

    task_id = sender.request.id if sender and hasattr(sender, "request") else kwargs.get("task_id")
    if task_id:
        try:
            job = CeleryTaskResult.objects.using("default").get(task_id=task_id)
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
            if is_missing_relation_error(e):
                warn_missing_table_once(
                    CeleryTaskResult._meta.db_table,
                    "Celery task success tracking",
                )
                return
            logger.error(f"Error in task_success signal for task {task_id}: {e}")


@task_failure.connect
def on_task_failure(task_id, exception, traceback, **kwargs):
    from .models import CeleryTaskResult

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task failure tracking",
        )
        return

    try:
        job = CeleryTaskResult.objects.using("default").get(task_id=task_id)
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
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task failure tracking",
            )
            return
        logger.error(f"Error in task_failure signal for task {task_id}: {e}")


@task_retry.connect
def on_task_retry(request, reason, einfo, **kwargs):
    from .models import CeleryTaskResult

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task retry tracking",
        )
        return

    try:
        job = CeleryTaskResult.objects.using("default").get(task_id=request.id)
        job.status = CeleryTaskResult.TaskStatus.RETRY
        job.retries += 1
        job.error_message = f"Retrying: {reason}"
        job.save(update_fields=["status", "retries", "error_message"])
    except Exception as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task retry tracking",
            )
            return
        logger.error(f"Error in task_retry signal for task {request.id}: {e}")

    # Emit retry metric
    try:
        from ..animes.services.metrics import TASK_RETRY_COUNT

        task_name = getattr(request, "task", "unknown") if hasattr(request, "task") else "unknown"
        TASK_RETRY_COUNT.labels(task_name=task_name).inc()
    except Exception:
        pass


@task_revoked.connect
def on_task_revoked(request, terminated, signum, expired, **kwargs):
    from .models import CeleryTaskResult

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task revoke tracking",
        )
        return

    task_id = request.id if hasattr(request, "id") else request.task_id
    try:
        job = CeleryTaskResult.objects.using("default").get(task_id=task_id)
        job.status = CeleryTaskResult.TaskStatus.REVOKED
        job.error_message = "Task revoked/terminated"
        job.date_completed = timezone.now()

        if job.date_started:
            job.execution_time = (job.date_completed - job.date_started).total_seconds()

        job.save(update_fields=["status", "error_message", "date_completed", "execution_time"])
    except Exception as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task revoke tracking",
            )
            return
        logger.error(f"Error in task_revoked signal for task {task_id}: {e}")


@worker_ready.connect
def start_worker_metrics_server(sender, **kwargs):
    """Start the worker metrics server when a worker becomes ready."""
    path = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
    if path:
        try:
            from prometheus_client import CollectorRegistry, multiprocess, start_http_server

            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry, path=path)
            # Port 8000 is used by web, so workers expose metrics on 9090.
            start_http_server(9090, registry=registry)
            logger.info("Started worker metrics server on port 9090")
        except Exception as e:
            logger.error(f"Failed to start worker metrics server: {e}")
