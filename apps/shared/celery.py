"""Shared Celery task helpers for consistent retries and logging."""

from __future__ import annotations

import logging
import time
from reprlib import repr as limited_repr
from typing import Any

from celery import Task, shared_task

logger = logging.getLogger("anishows.celery")

RETRY_POLICIES: dict[str, dict[str, Any]] = {
    "none": {},
    "quick": {
        "max_retries": 2,
        "default_retry_delay": 30,
        "retry_backoff": True,
        "retry_backoff_max": 300,
        "retry_jitter": True,
    },
    "standard": {
        "max_retries": 3,
        "default_retry_delay": 60,
        "retry_backoff": True,
        "retry_backoff_max": 600,
        "retry_jitter": True,
    },
    "external_api": {
        "max_retries": 5,
        "default_retry_delay": 60,
        "retry_backoff": True,
        "retry_backoff_max": 900,
        "retry_jitter": True,
    },
    "long": {
        "max_retries": 3,
        "default_retry_delay": 180,
        "retry_backoff": True,
        "retry_backoff_max": 1800,
        "retry_jitter": True,
    },
}

TIME_LIMIT_PRESETS: dict[str, tuple[int, int]] = {
    "quick": (300, 240),
    "standard": (1800, 1500),
    "long": (3600, 3300),
    "extended": (7200, 6900),
}


def _serialize_for_log(value: Any) -> str:
    return limited_repr(value)


class ObservedTask(Task):
    """Task base with consistent lifecycle logging."""

    abstract = True

    def before_start(self, task_id, args, kwargs):
        self._started_monotonic = time.monotonic()
        logger.info(
            "Task started: %s",
            self.name,
            extra={
                "task_id": task_id,
                "task_args": _serialize_for_log(args),
                "task_kwargs": _serialize_for_log(kwargs),
            },
        )
        super().before_start(task_id, args, kwargs)

    def on_success(self, retval, task_id, args, kwargs):
        duration = self._task_duration_seconds()
        logger.info(
            "Task completed: %s",
            self.name,
            extra={
                "task_id": task_id,
                "duration_seconds": duration,
                "task_result": _serialize_for_log(retval),
            },
        )
        super().on_success(retval, task_id, args, kwargs)

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        duration = self._task_duration_seconds()
        logger.error(
            "Task failed: %s",
            self.name,
            extra={
                "task_id": task_id,
                "duration_seconds": duration,
                "task_error": str(exc),
            },
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        logger.warning(
            "Task retry scheduled: %s",
            self.name,
            extra={
                "task_id": task_id,
                "retry_count": self.request.retries + 1,
                "task_error": str(exc),
            },
        )
        super().on_retry(exc, task_id, args, kwargs, einfo)

    def _task_duration_seconds(self) -> float | None:
        started = getattr(self, "_started_monotonic", None)
        if started is None:
            return None
        return round(time.monotonic() - started, 3)


def task_options(
    *,
    retry_policy: str = "standard",
    time_limit_preset: str | None = None,
    base: type[Task] | None = None,
    bind: bool = True,
    **overrides: Any,
) -> dict[str, Any]:
    """Build a consistent Celery task configuration."""
    options: dict[str, Any] = {}
    if bind:
        options["bind"] = True
    if retry_policy:
        options.update(RETRY_POLICIES.get(retry_policy, {}))
    if time_limit_preset:
        time_limit, soft_time_limit = TIME_LIMIT_PRESETS[time_limit_preset]
        options.setdefault("time_limit", time_limit)
        options.setdefault("soft_time_limit", soft_time_limit)
    options["base"] = base or ObservedTask
    options.update(overrides)
    return options


def observed_shared_task(**options: Any):
    """Create a shared task using the repository's default task options."""
    return shared_task(**task_options(**options))
