import json
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
from django.core.cache import cache
from django.db import DatabaseError
from django.utils import timezone

from ..shared.celery import redact_task_kwargs
from ..shared.errors import CACHE_ERRORS
from ..shared.logger import logger
from .db_safety import (
    is_missing_relation_error,
    model_table_exists,
    warn_missing_table_once,
)

# What updating a CeleryTaskResult row can raise: database errors (including a
# missing table before migrations), and TypeError/ValueError when task args,
# kwargs or a result are not JSON-serialisable. Anything else escapes to Celery,
# whose signal dispatcher logs receiver errors with a traceback and carries on,
# so tracking can never fail a task.
TRACKING_ERRORS = (DatabaseError, TypeError, ValueError)

# High-frequency tasks that never get a CeleryTaskResult row: per-request log
# writers and the every-minute jobs. Each run only stamps ``celery:lastrun:<task>``
# (kept two days) for the admin System page. Import-safe; groups adding a
# high-frequency task may ask G6 to list it here.
UNTRACKED_TASKS: frozenset[str] = frozenset(
    {
        "apps.core.tasks.logging_tasks.log_request_async",
        "apps.core.tasks.logging_tasks.log_exception_async",
        "apps.core.tasks.cleanup_tasks.collect_queue_metrics",
        "apps.core.tasks.cleanup_tasks.flush_forum_view_counts",
    }
)
LAST_RUN_CACHE_PREFIX = "celery:lastrun:"
LAST_RUN_CACHE_TTL_SECONDS = 2 * 24 * 60 * 60
# Stored task args/kwargs are capped; a bigger payload keeps a short preview.
MAX_STORED_ARGS_BYTES = 2048


def last_run_cache_key(task_name: str) -> str:
    return f"{LAST_RUN_CACHE_PREFIX}{task_name}"


def _record_last_run(task_name: str) -> None:
    with suppress(*CACHE_ERRORS):
        cache.set(
            last_run_cache_key(task_name),
            timezone.now().isoformat(),
            timeout=LAST_RUN_CACHE_TTL_SECONDS,
        )


def _signal_task_name(sender=None, request=None) -> str:
    """The task name from a signal's sender (a Task) or request (a Context)."""
    name = getattr(sender, "name", None) or getattr(request, "task", None)
    return name if isinstance(name, str) else ""


def is_untracked(task_name: str) -> bool:
    return task_name in UNTRACKED_TASKS


def _capped(value, empty):
    """``value`` if its JSON form fits ``MAX_STORED_ARGS_BYTES``, else a short preview."""
    try:
        encoded = json.dumps(value, default=str)
    except (TypeError, ValueError):
        return empty
    if len(encoded.encode("utf-8")) <= MAX_STORED_ARGS_BYTES:
        return value
    preview = encoded[: MAX_STORED_ARGS_BYTES // 2]
    if isinstance(empty, dict):
        return {"_truncated": True, "_preview": preview}
    return ["[truncated]", preview]


def stored_task_args(args) -> list:
    return _capped(list(args) if args else [], [])


def stored_task_kwargs(kwargs) -> dict:
    return _capped(redact_task_kwargs(kwargs), {})


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

    task_name = getattr(task, "name", "unknown")
    if is_untracked(task_name):
        _record_last_run(task_name)
        return

    if not model_table_exists(CeleryTaskResult):
        warn_missing_table_once(
            CeleryTaskResult._meta.db_table,
            "Celery task pre-run tracking",
        )
        return

    try:
        # Handle cases where the view already created a PENDING result
        job, created = CeleryTaskResult.objects.using("default").get_or_create(
            task_id=task_id,
            defaults={
                "task_name": task_name,
                "status": CeleryTaskResult.TaskStatus.STARTED,
                "date_started": timezone.now(),
                "task_args": stored_task_args(args),
                "task_kwargs": stored_task_kwargs(kwargs),
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
                job.task_args = stored_task_args(args)
            if not job.task_kwargs and kwargs:
                job.task_kwargs = stored_task_kwargs(kwargs)
            job.save(
                update_fields=["status", "date_started", "task_name", "task_args", "task_kwargs"]
            )
    except TRACKING_ERRORS as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task pre-run tracking",
            )
            return
        logger.exception("Error in task_prerun signal for task %s", task_id)


@task_success.connect
def on_task_success(sender=None, result=None, **kwargs):
    from .models import CeleryTaskResult

    if is_untracked(_signal_task_name(sender=sender)):
        return

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
            logger.warning("CeleryTaskResult not found for task_success (id: %s)", task_id)
        except TRACKING_ERRORS as e:
            if is_missing_relation_error(e):
                warn_missing_table_once(
                    CeleryTaskResult._meta.db_table,
                    "Celery task success tracking",
                )
                return
            logger.exception("Error in task_success signal for task %s", task_id)


@task_failure.connect
def on_task_failure(task_id, exception, traceback, **kwargs):
    from .models import CeleryTaskResult

    if is_untracked(_signal_task_name(sender=kwargs.get("sender"))):
        return

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
    except (CeleryTaskResult.DoesNotExist, *TRACKING_ERRORS) as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task failure tracking",
            )
            return
        logger.exception("Error in task_failure signal for task %s", task_id)


@task_retry.connect
def on_task_retry(request, reason, einfo, **kwargs):
    from .models import CeleryTaskResult

    if is_untracked(_signal_task_name(sender=kwargs.get("sender"), request=request)):
        return

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
    except (CeleryTaskResult.DoesNotExist, *TRACKING_ERRORS) as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task retry tracking",
            )
            return
        logger.exception("Error in task_retry signal for task %s", request.id)

    # Emit retry metric. Metric objects swallow their own failures.
    from ..animes.services.metrics import TASK_RETRY_COUNT

    task_name = getattr(request, "task", "unknown") if hasattr(request, "task") else "unknown"
    TASK_RETRY_COUNT.labels(task_name=task_name).inc()


@task_revoked.connect
def on_task_revoked(request, terminated, signum, expired, **kwargs):
    from .models import CeleryTaskResult

    if is_untracked(_signal_task_name(sender=kwargs.get("sender"), request=request)):
        return

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
    except (CeleryTaskResult.DoesNotExist, *TRACKING_ERRORS) as e:
        if is_missing_relation_error(e):
            warn_missing_table_once(
                CeleryTaskResult._meta.db_table,
                "Celery task revoke tracking",
            )
            return
        logger.exception("Error in task_revoked signal for task %s", task_id)


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
        except (ImportError, OSError, ValueError):
            # ImportError: prometheus_client missing; OSError: port 9090 taken
            # or the multiprocess directory unreadable; ValueError: bad path.
            logger.exception("Failed to start worker metrics server")
