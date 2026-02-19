"""
Base task infrastructure for unified Celery tasks.

Provides:
- BaseTask class with common functionality
- Decorator utilities for retry configuration
- Service management helpers
- Metrics collection
- Task deduplication with idempotency keys
- Lock-based task execution prevention
"""

import asyncio
import functools
import hashlib
import logging
import time
from typing import Any, Callable, Dict, Optional, TypeVar, Union
from contextlib import asynccontextmanager
from celery import Task
from celery.exceptions import MaxRetriesExceededError
from django.core.cache import cache

logger = logging.getLogger(__name__)

# Retry configuration presets
RETRY_PRESETS = {
    "quick": {
        "max_retries": 3,
        "default_retry_delay": 60,
        "retry_backoff": True,
        "retry_backoff_max": 300,
        "retry_jitter": True,
    },
    "standard": {
        "max_retries": 3,
        "default_retry_delay": 120,
        "retry_backoff": True,
        "retry_backoff_max": 600,
        "retry_jitter": True,
    },
    "long": {
        "max_retries": 3,
        "default_retry_delay": 180,
        "retry_backoff": True,
        "retry_backoff_max": 900,
        "retry_jitter": True,
    },
    "external_api": {
        "max_retries": 5,
        "default_retry_delay": 60,
        "retry_backoff": True,
        "retry_backoff_max": 600,
        "retry_jitter": True,
    },
}

# Time limit presets (in seconds)
TIME_LIMIT_PRESETS = {
    "quick": (300, 240),  # (time_limit, soft_time_limit)
    "standard": (1800, 1500),  # 30 min / 25 min
    "long": (3600, 3300),  # 1 hour / 55 min
    "extended": (7200, 6900),  # 2 hours / 1h 55min
}


class TaskMetrics:
    """Collect metrics for task execution."""

    def __init__(self):
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None
        self.api_calls: Dict[str, int] = {}
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

    def to_dict(self) -> Dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            "duration_seconds": self.duration,
            "api_calls": self.api_calls,
            "records_processed": self.records_processed,
            "errors": self.errors,
        }


class BaseTask(Task):
    """
    Base task class with common functionality.

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
        key_data = f"{self.name}:{str(args)}:{str(kwargs)}"
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
        """
        Override apply_async to support idempotency and locking.

        Args:
            idempotency_key: Custom idempotency key (optional)
            skip_if_running: Skip if same task is currently running
        """
        task_args = args or ()
        task_kwargs = kwargs or {}

        # Check idempotency
        if self.enable_deduplication:
            idempotency_key = options.pop("idempotency_key", None)
            if not idempotency_key:
                idempotency_key = self._generate_idempotency_key(task_args, task_kwargs)

            cache_key = f"celery:idempotency:{idempotency_key}"

            # Check if this task was recently executed
            if cache.get(cache_key):
                logger.info(
                    f"Task {self.name} skipped due to idempotency (key: {idempotency_key})"
                )
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
            cache.set(cache_key, True, timeout=self.idempotency_ttl)

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
        if self.enable_locking:
            lock_key = self._get_lock_key(args, kwargs)

            # Try to acquire lock
            lock_acquired = cache.add(lock_key, True, timeout=self.lock_timeout)

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
        """
        Context manager for service lifecycle.

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
        logger.info(
            f"Task {self.name} completed successfully",
            extra={
                "task_id": task_id,
                "metrics": self.metrics.to_dict(),
            },
        )
        # Emit Prometheus metrics
        try:
            from apps.animes.services.metrics import (
                TASK_EXECUTION_TIME,
                TASK_EXECUTION_COUNT,
                ANIME_SYNCED,
            )

            duration = self.metrics.duration
            queue = getattr(self, "queue", "default")

            # Record execution time
            TASK_EXECUTION_TIME.labels(
                task_name=self.name, queue=queue, status="success"
            ).observe(duration)

            # Record execution count
            TASK_EXECUTION_COUNT.labels(
                task_name=self.name, queue=queue, status="success"
            ).inc()

            # Record anime synced if applicable
            if hasattr(self, "sync_type") and self.metrics.records_processed > 0:
                ANIME_SYNCED.labels(
                    sync_type=getattr(self, "sync_type", "unknown"), source="anilist"
                ).inc(self.metrics.records_processed)

        except Exception as e:
            logger.warning(f"Failed to emit Prometheus metrics: {e}")

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails."""
        self.metrics.stop()
        logger.error(
            f"Task {self.name} failed: {exc}",
            extra={
                "task_id": task_id,
                "metrics": self.metrics.to_dict(),
                "exception": str(exc),
            },
        )
        # Emit Prometheus metrics for failure
        try:
            from apps.animes.services.metrics import (
                TASK_EXECUTION_TIME,
                TASK_EXECUTION_COUNT,
            )

            duration = self.metrics.duration
            queue = getattr(self, "queue", "default")

            # Record execution time
            TASK_EXECUTION_TIME.labels(
                task_name=self.name, queue=queue, status="failure"
            ).observe(duration)

            # Record execution count
            TASK_EXECUTION_COUNT.labels(
                task_name=self.name, queue=queue, status="failure"
            ).inc()

        except Exception as e:
            logger.warning(f"Failed to emit Prometheus metrics: {e}")

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        """Called when task retries."""
        logger.warning(
            f"Task {self.name} retrying (attempt {self.request.retries + 1}/{self.max_retries}): {exc}",
            extra={"task_id": task_id, "retry_count": self.request.retries},
        )


def task_with_retry(
    retry_preset: str = "standard",
    time_preset: str = "standard",
    bind: bool = True,
    queue: str = "default",
    **kwargs,
):
    """
    Decorator factory for tasks with preset retry configurations.

    Args:
        retry_preset: Key from RETRY_PRESETS
        time_preset: Key from TIME_LIMIT_PRESETS
        bind: Whether to bind task instance
        queue: Queue name
        **kwargs: Additional task options

    Usage:
        @task_with_retry(retry_preset='quick', queue='low_priority')
        def my_task(self, ...):
            pass
    """

    def decorator(func: Callable) -> Callable:
        retry_config = RETRY_PRESETS.get(retry_preset, RETRY_PRESETS["standard"])
        time_limit, soft_time_limit = TIME_LIMIT_PRESETS.get(
            time_preset, TIME_LIMIT_PRESETS["standard"]
        )

        @functools.wraps(func)
        def wrapper(*args, **func_kwargs):
            return func(*args, **func_kwargs)

        # Store task configuration for later application
        wrapper._task_config = {
            "bind": bind,
            "queue": queue,
            "time_limit": time_limit,
            "soft_time_limit": soft_time_limit,
            **retry_config,
            **kwargs,
        }

        return wrapper

    return decorator


# Helper to run async code in sync celery task
def run_async_in_task(coro):
    """Helper to run async code in sync celery task context."""
    return asyncio.run(coro)


def task_with_deduplication(ttl_seconds: int = 3600):
    """
    Decorator to enable task deduplication.

    Prevents the same task from running multiple times within the TTL period.

    Args:
        ttl_seconds: Time-to-live for idempotency cache (default: 1 hour)

    Usage:
        @shared_task(base=BaseTask, bind=True)
        @task_with_deduplication(ttl_seconds=1800)
        def my_task(self, ...):
            pass
    """

    def decorator(func):
        @functools.wraps(func)
        def wrapper(self, *args, **kwargs):
            return func(self, *args, **kwargs)

        # Mark function with deduplication settings
        wrapper._deduplication_ttl = ttl_seconds
        wrapper._enable_deduplication = True
        return wrapper

    return decorator


def task_with_lock(timeout_seconds: int = 300):
    """
    Decorator to enable task execution locking.

    Prevents concurrent execution of the same task with identical arguments.

    Args:
        timeout_seconds: Lock timeout in seconds (default: 5 minutes)

    Usage:
        @shared_task(base=BaseTask, bind=True)
        @task_with_lock(timeout_seconds=600)
        def my_task(self, ...):
            pass
    """

    def decorator(func):
        @functools.wraps(func)
        def wrapper(self, *args, **kwargs):
            return func(self, *args, **kwargs)

        # Mark function with locking settings
        wrapper._lock_timeout = timeout_seconds
        wrapper._enable_locking = True
        return wrapper

    return decorator


def generate_task_idempotency_key(task_name: str, *args, **kwargs) -> str:
    """
    Generate an idempotency key for a task.

    Args:
        task_name: Name of the task
        *args: Task positional arguments
        **kwargs: Task keyword arguments

    Returns:
        SHA256 hash string representing the idempotency key
    """
    key_data = f"{task_name}:{str(args)}:{str(kwargs)}"
    return hashlib.sha256(key_data.encode()).hexdigest()
