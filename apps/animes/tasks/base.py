"""
Base task infrastructure for unified Celery tasks.

Provides:
- BaseTask class with common functionality
- Service management helpers
- Metrics collection
"""

import asyncio
import hashlib
import time
from contextlib import asynccontextmanager
from typing import Any

from django.core.cache import cache

from apps.shared.celery import RETRY_POLICIES, TIME_LIMIT_PRESETS, ObservedTask
from apps.shared.logger import logger

# Retry configuration presets
RETRY_PRESETS = RETRY_POLICIES

# Time limit presets (in seconds)
class TaskMetrics:
    """Collect metrics for task execution."""

    def __init__(self):
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.api_calls: dict[str, int] = {}
        self.records_processed: int = 0
        self.errors: int = 0

    def start(self):
        """Start metrics collection."""
        self.start_time = time.time()

    def stop(self):
        """Stop metrics collection."""
        self.end_time = time.time()

    @property
    def duration(self) -> float:
        """Get task duration in seconds."""
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0

    def record_api_call(self, service: str, count: int = 1):
        """Record API calls."""
        self.api_calls[service] = self.api_calls.get(service, 0) + count

    def record_records(self, count: int):
        """Record number of records processed."""
        self.records_processed += count

    def record_error(self):
        """Record an error."""
        self.errors += 1

    def to_dict(self) -> dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            "duration_seconds": self.duration,
            "api_calls": self.api_calls,
            "records_processed": self.records_processed,
            "errors": self.errors,
        }

class BaseTask(ObservedTask):
    """Base task class with common functionality.

    Features:
    - Automatic service management with context manager
    - Metrics collection
    - Structured logging
    - Async/sync bridge utilities
    - Task deduplication with idempotency keys
    - Task locking to prevent concurrent execution
    """

    abstract = True

    # Override in subclasses
    service_class = None
    service_kwargs = {}

    # Task deduplication settings
    idempotency_ttl = 3600  # 1 hour default
    enable_deduplication = False
    enable_locking = False
    lock_timeout = 300  # 5 minutes default

    def __init__(self):
        super().__init__()
        self.metrics = TaskMetrics()

    def _generate_idempotency_key(self, args, kwargs):
        """Generate idempotency key from task arguments."""
        key_data = f"{self.name}:{args!s}:{kwargs!s}"
        return hashlib.sha256(key_data.encode()).hexdigest()

    def _get_lock_key(self, args, kwargs):
        """Generate lock key for task execution."""
        return f"celery:lock:{self._generate_idempotency_key(args, kwargs)}"

    def _get_idempotency_cache_key(self, args, kwargs):
        """Generate cache key for idempotency check."""
        return f"celery:idempotency:{self._generate_idempotency_key(args, kwargs)}"

    def apply_async(
        self,
        args=None,
        kwargs=None,
        task_id=None,
        producer=None,
        link=None,
        link_error=None,
        shadow=None,
        **options,
    ):
        """Override apply_async to support idempotency and locking.

        Args:
            idempotency_key: Custom idempotency key (optional)
            skip_if_running: Skip if same task is currently running
        """
        task_args = args or ()
        task_kwargs = kwargs or {}

        # Check idempotency
        if getattr(self.run, "_enable_deduplication", self.enable_deduplication):
            idempotency_key = options.pop("idempotency_key", None)
            if not idempotency_key:
                idempotency_key = self._generate_idempotency_key(task_args, task_kwargs)

            cache_key = f"celery:idempotency:{idempotency_key}"

            # Check if this task was recently executed
            if cache.get(cache_key):
                logger.info(f"Task {self.name} skipped due to idempotency (key: {idempotency_key})")
                # Return a mock AsyncResult indicating duplicate
                from celery.result import EagerResult

                return EagerResult(
                    task_id or self.app.gen_task_name(self.name, self.name),
                    {
                        "status": "skipped",
                        "reason": "duplicate",
                        "idempotency_key": idempotency_key,
                    },
                    "SUCCESS",
                )

            # Store idempotency marker before execution
            ttl = getattr(self.run, "_deduplication_ttl", self.idempotency_ttl)
            cache.set(cache_key, True, timeout=ttl)

        return super().apply_async(
            args=task_args,
            kwargs=task_kwargs,
            task_id=task_id,
            producer=producer,
            link=link,
            link_error=link_error,
            shadow=shadow,
            **options,
        )

    def __call__(self, *args, **kwargs):
        """Execute task with optional locking."""
        if getattr(self.run, "_enable_locking", self.enable_locking):
            lock_key = self._get_lock_key(args, kwargs)

            # Try to acquire lock
            timeout = getattr(self.run, "_lock_timeout", self.lock_timeout)
            lock_acquired = cache.add(lock_key, True, timeout=timeout)

            if not lock_acquired:
                logger.warning(f"Task {self.name} skipped - already running")
                return {"status": "skipped", "reason": "already_running"}

            try:
                return self.run(*args, **kwargs)
            finally:
                # Release lock
                cache.delete(lock_key)
        else:
            return self.run(*args, **kwargs)

    @asynccontextmanager
    async def service_context(self, **kwargs):
        """Context manager for service lifecycle.

        Usage:
            async with self.service_context() as service:
                result = await service.do_something()
        """
        service = None
        try:
            service = self.service_class(**{**self.service_kwargs, **kwargs})
            yield service
        finally:
            if service and hasattr(service, "close"):
                await service.close()

    def run_async(self, coro):
        """Run async coroutine in sync context."""
        return asyncio.run(coro)

    def on_success(self, retval, task_id, args, kwargs):
        """Called when task succeeds."""
        self.metrics.stop()
        try:
            from django.utils import timezone

            from apps.core.models import CeleryTaskResult

            job = CeleryTaskResult.objects.get(task_id=task_id)
            job.status = CeleryTaskResult.TaskStatus.SUCCESS
            job.result_data = (
                retval
                if isinstance(retval, (dict, list, str, int, float, bool, type(None)))
                else {"result": str(retval)}
            )
            job.date_completed = timezone.now()
            if job.date_started:
                job.execution_time = (job.date_completed - job.date_started).total_seconds()
            job.save(update_fields=["status", "result_data", "date_completed", "execution_time"])
        except Exception as e:
            logger.error(f"Failed to update CeleryTaskResult on success: {e}")

        # Emit task metrics
        try:
            from apps.animes.services.metrics import (
                ANIME_SYNCED,
                TASK_EXECUTION_COUNT,
                TASK_EXECUTION_TIME,
            )

            duration = self.metrics.duration
            queue = getattr(self, "queue", "default")

            # Record execution time
            TASK_EXECUTION_TIME.labels(task_name=self.name, queue=queue, status="success").observe(
                duration
            )

            # Record execution count
            TASK_EXECUTION_COUNT.labels(task_name=self.name, queue=queue, status="success").inc()

            # Record anime synced if applicable
            if hasattr(self, "sync_type") and self.metrics.records_processed > 0:
                source = "jikan"
                service_class = getattr(self, "service_class", None)
                if service_class is not None and getattr(service_class, "__name__", "") == "AniListService":
                    source = "anilist"
                ANIME_SYNCED.labels(
                    sync_type=getattr(self, "sync_type", "unknown"), source=source
                ).inc(self.metrics.records_processed)

        except Exception as e:
            logger.warning(f"Failed to emit task metrics: {e}")
        super().on_success(retval, task_id, args, kwargs)

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails."""
        self.metrics.stop()
        # Update CeleryTaskResult in database
        try:
            from django.utils import timezone

            from apps.core.models import CeleryTaskResult

            job = CeleryTaskResult.objects.get(task_id=task_id)
            job.status = CeleryTaskResult.TaskStatus.FAILURE
            job.error_message = str(exc)
            job.traceback = str(einfo.traceback) if einfo else ""
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
            logger.error(f"Failed to update CeleryTaskResult on failure: {e}")

        # Emit failure metrics
        try:
            from apps.animes.services.metrics import (
                TASK_EXECUTION_COUNT,
                TASK_EXECUTION_TIME,
            )

            duration = self.metrics.duration
            queue = getattr(self, "queue", "default")

            # Record execution time
            TASK_EXECUTION_TIME.labels(task_name=self.name, queue=queue, status="failure").observe(
                duration
            )

            # Record execution count
            TASK_EXECUTION_COUNT.labels(task_name=self.name, queue=queue, status="failure").inc()

        except Exception as e:
            logger.warning(f"Failed to emit failure metrics: {e}")
        super().on_failure(exc, task_id, args, kwargs, einfo)

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        """Called when task retries."""
        # Update CeleryTaskResult
        try:
            from apps.core.models import CeleryTaskResult

            job = CeleryTaskResult.objects.get(task_id=task_id)
            job.status = CeleryTaskResult.TaskStatus.RETRY
            job.retries += 1
            job.error_message = f"Retrying: {exc}"
            job.save(update_fields=["status", "retries", "error_message"])
        except Exception as e:
            logger.error(f"Failed to update CeleryTaskResult on retry: {e}")

        # Emit retry metric
        try:
            from apps.animes.services.metrics import TASK_RETRY_COUNT

            TASK_RETRY_COUNT.labels(task_name=self.name).inc()
        except Exception:
            pass
        super().on_retry(exc, task_id, args, kwargs, einfo)

# Helper to run async code in sync celery task
def run_async_in_task(coro):
    """Helper to run async code in sync celery task context."""
    return asyncio.run(coro)
