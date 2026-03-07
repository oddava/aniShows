from apps.shared.logger import logger
from celery.signals import (
    task_failure,
    task_prerun,
    task_retry,
    task_revoked,
    task_success,
)
from django.utils import timezone


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
