"""
Base task infrastructure for unified Celery tasks.

Provides:
- BaseTask class with common functionality
- Decorator utilities for retry configuration
- Service management helpers
- Metrics collection
"""

import asyncio
import functools
import logging
import time
from typing import Any, Callable, Dict, Optional, TypeVar
from contextlib import asynccontextmanager
from celery import Task
from celery.exceptions import MaxRetriesExceededError

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
    """

    abstract = True

    # Override in subclasses
    service_class = None
    service_kwargs = {}

    def __init__(self):
        super().__init__()
        self.metrics = TaskMetrics()

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
