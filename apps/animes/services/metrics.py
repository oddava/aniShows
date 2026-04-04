from apps.shared.logger import logger

"""
Prometheus metrics integration for Celery tasks.

Provides:
- Task execution metrics (duration, counts, failures)
- Queue depth monitoring
- Worker performance metrics
- Custom metrics for business logic

Usage:
    from apps.animes.services.metrics import task_timer, increment_counter

    @shared_task(bind=True)
    def my_task(self):
        with task_timer("my_task"):
            # Task logic here
            pass
"""

import functools
import time
from collections.abc import Callable
from contextlib import contextmanager


class DummyMetric:
    def __init__(self, *args, **kwargs):
        pass

    def labels(self, *args, **kwargs):
        return self

    def inc(self, *args, **kwargs):
        pass

    def observe(self, *args, **kwargs):
        pass

    def set(self, *args, **kwargs):
        pass

    def info(self, *args, **kwargs):
        pass


try:
    from prometheus_client import Counter, Gauge, Histogram, Info

    PROMETHEUS_AVAILABLE = True

except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.warning("prometheus_client not installed - metrics disabled")

    Counter = DummyMetric
    Histogram = DummyMetric
    Gauge = DummyMetric
    Info = DummyMetric


class _MetricLabelProxy:
    def __init__(self, metric):
        self._metric = metric

    def inc(self, *args, **kwargs):
        _safe_metric_operation(self._metric.inc, *args, **kwargs)

    def observe(self, *args, **kwargs):
        _safe_metric_operation(self._metric.observe, *args, **kwargs)

    def set(self, *args, **kwargs):
        _safe_metric_operation(self._metric.set, *args, **kwargs)

    def info(self, *args, **kwargs):
        _safe_metric_operation(self._metric.info, *args, **kwargs)


class _MetricProxy:
    def __init__(self, metric):
        self._metric = metric

    def labels(self, *args, **kwargs):
        labeled_metric = _safe_metric_operation(self._metric.labels, *args, **kwargs)
        if labeled_metric is None:
            return _MetricLabelProxy(DummyMetric())
        return _MetricLabelProxy(labeled_metric)

    def inc(self, *args, **kwargs):
        _safe_metric_operation(self._metric.inc, *args, **kwargs)

    def observe(self, *args, **kwargs):
        _safe_metric_operation(self._metric.observe, *args, **kwargs)

    def set(self, *args, **kwargs):
        _safe_metric_operation(self._metric.set, *args, **kwargs)

    def info(self, *args, **kwargs):
        _safe_metric_operation(self._metric.info, *args, **kwargs)


def _safe_metric_operation(operation, *args, **kwargs):
    try:
        return operation(*args, **kwargs)
    except (FileNotFoundError, OSError, ValueError):
        return None


def _safe_metric(metric_cls, *args, **kwargs):
    """Create a Prometheus metric, handling duplicate registration in multi-process mode."""
    try:
        return _MetricProxy(metric_cls(*args, **kwargs))
    except ValueError:
        # Already registered (happens in gunicorn preload+fork or module re-import)
        # Return a dummy that delegates to the existing registered metric
        pass

    # Fallback: return a no-op dummy
    if PROMETHEUS_AVAILABLE:
        class _NoOpLabels:
            def inc(self, *a, **kw): pass
            def observe(self, *a, **kw): pass
            def set(self, *a, **kw): pass
            def info(self, *a, **kw): pass
        class _NoOp:
            def labels(self, *a, **kw): return _NoOpLabels()
            def inc(self, *a, **kw): pass
            def observe(self, *a, **kw): pass
            def set(self, *a, **kw): pass
            def info(self, *a, **kw): pass
        return _NoOp()
    return DummyMetric()


TASK_EXECUTION_TIME = _safe_metric(
    Histogram,
    "celery_task_execution_time_seconds",
    "Time spent executing Celery tasks",
    ["task_name", "queue", "status"],
    buckets=[
        0.1,
        0.5,
        1.0,
        2.5,
        5.0,
        10.0,
        30.0,
        60.0,
        120.0,
        300.0,
        600.0,
        1800.0,
        3600.0,
    ],
)

TASK_EXECUTION_COUNT = _safe_metric(
    Counter,
    "celery_task_executions_total",
    "Total number of Celery task executions",
    ["task_name", "queue", "status"],
)

TASK_RETRY_COUNT = _safe_metric(
    Counter,
    "celery_task_retries_total",
    "Total number of Celery task retries",
    ["task_name"],
)
QUEUE_SIZE = _safe_metric(
    Gauge,
    "celery_queue_size",
    "Current number of tasks in queue",
    ["queue_name"],
)
WORKER_TASKS_PROCESSED = _safe_metric(
    Counter,
    "celery_worker_tasks_processed_total",
    "Total tasks processed by worker",
    ["worker_name", "queue"],
)

WORKER_TASKS_FAILED = _safe_metric(
    Counter,
    "celery_worker_tasks_failed_total",
    "Total tasks failed by worker",
    ["worker_name", "queue"],
)

# API call metrics
API_CALL_DURATION = _safe_metric(
    Histogram,
    "external_api_call_duration_seconds",
    "Duration of external API calls",
    ["service", "endpoint", "status"],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

API_CALL_COUNT = _safe_metric(
    Counter,
    "external_api_calls_total",
    "Total number of external API calls",
    ["service", "endpoint", "status"],
)

# Business logic metrics
ANIME_SYNCED = _safe_metric(
    Counter,
    "anime_synced_total",
    "Total number of anime synced",
    ["sync_type", "source"],
)

RECOMMENDATIONS_GENERATED = _safe_metric(
    Counter,
    "recommendations_generated_total",
    "Total number of recommendations generated",
    ["algorithm"],
)

USER_IMPORTS_PROCESSED = _safe_metric(
    Counter,
    "user_imports_processed_total",
    "Total number of user imports processed",
    ["source", "status"],
)

OFFLINE_SYNC_STAGE_SUCCESS_TOTAL = _safe_metric(
    Counter,
    "offline_sync_stage_success_total",
    "Total number of successful offline sync stage executions",
    ["stage"],
)

OFFLINE_SYNC_STAGE_FAILURE_TOTAL = _safe_metric(
    Counter,
    "offline_sync_stage_failure_total",
    "Total number of failed offline sync stage executions",
    ["stage", "reason"],
)

OFFLINE_SYNC_QUARANTINE_TOTAL = _safe_metric(
    Counter,
    "offline_sync_quarantine_total",
    "Total number of offline sync records quarantined",
    ["stage", "reason"],
)

OFFLINE_SYNC_RETRY_AGE_SECONDS = _safe_metric(
    Histogram,
    "offline_sync_retry_age_seconds",
    "Age in seconds between offline sync stage attempts",
    ["stage"],
    buckets=[30, 60, 120, 300, 600, 900, 1800, 3600, 21600, 86400, 172800],
)

# Circuit breaker state metric (0=CLOSED, 1=OPEN, 2=HALF_OPEN)
CIRCUIT_BREAKER_STATE = _safe_metric(
    Gauge,
    "circuit_breaker_state",
    "Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
    ["name"],
)

# State mapping for circuit breaker
_CB_STATE_MAP = {
    "CLOSED": 0,
    "OPEN": 1,
    "HALF_OPEN": 2,
}

def update_circuit_breaker_state(name: str, state: str):
    """Update the circuit breaker state Prometheus metric.

    Args:
        name: Circuit breaker name (e.g., 'anilist_api')
        state: One of 'CLOSED', 'OPEN', 'HALF_OPEN'
    """
    if PROMETHEUS_AVAILABLE:
        CIRCUIT_BREAKER_STATE.labels(name=name).set(_CB_STATE_MAP.get(state, 0))

@contextmanager
def task_timer(task_name: str, queue: str = "default"):
    """Context manager to time task execution and record metrics.

    Args:
        task_name: Name of the task
        queue: Queue name

    Usage:
        with task_timer("my_task", queue="default"):
            # Task logic
            pass
    """
    start_time = time.time()
    status = "success"

    try:
        yield
    except Exception:
        status = "failure"
        raise
    finally:
        duration = time.time() - start_time
        TASK_EXECUTION_TIME.labels(
            task_name=task_name, queue=queue, status=status
        ).observe(duration)
        TASK_EXECUTION_COUNT.labels(
            task_name=task_name, queue=queue, status=status
        ).inc()

def timed_task(queue: str = "default"):
    """Decorator to automatically time task execution.

    Args:
        queue: Queue name for metrics

    Usage:
        @shared_task(bind=True)
        @timed_task(queue="default")
        def my_task(self, ...):
            pass
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Get task name from first argument if it's a bound task
            task_name = func.__name__
            if args and hasattr(args[0], "name"):
                task_name = args[0].name

            with task_timer(task_name, queue):
                return func(*args, **kwargs)

        return wrapper

    return decorator

def increment_counter(metric_name: str, labels: dict | None = None, value: int = 1):
    """Increment a counter metric.

    Args:
        metric_name: Name of the metric (e.g., 'anime_synced', 'api_calls')
        labels: Dictionary of label values
        value: Amount to increment by
    """
    if not PROMETHEUS_AVAILABLE:
        return

    metric_map = {
        "anime_synced": ANIME_SYNCED,
        "api_calls": API_CALL_COUNT,
        "recommendations": RECOMMENDATIONS_GENERATED,
        "user_imports": USER_IMPORTS_PROCESSED,
    }

    metric = metric_map.get(metric_name)
    if metric and labels:
        metric.labels(**labels).inc(value)

def observe_histogram(metric_name: str, value: float, labels: dict | None = None):
    """Observe a value in a histogram metric.

    Args:
        metric_name: Name of the metric
        value: Value to observe
        labels: Dictionary of label values
    """
    if not PROMETHEUS_AVAILABLE:
        return

    metric_map = {
        "task_duration": TASK_EXECUTION_TIME,
        "api_duration": API_CALL_DURATION,
    }

    metric = metric_map.get(metric_name)
    if metric and labels:
        metric.labels(**labels).observe(value)

@contextmanager
def api_timer(service: str, endpoint: str = "unknown"):
    """Context manager to time external API calls.

    Args:
        service: Service name (e.g., 'anilist', 'jikan')
        endpoint: API endpoint name

    Usage:
        with api_timer("anilist", endpoint="search"):
            # API call
            pass
    """
    start_time = time.time()
    status = "success"

    try:
        yield
    except Exception:
        status = "failure"
        raise
    finally:
        duration = time.time() - start_time
        API_CALL_DURATION.labels(
            service=service, endpoint=endpoint, status=status
        ).observe(duration)
        API_CALL_COUNT.labels(service=service, endpoint=endpoint, status=status).inc()

def update_queue_size(queue_name: str, size: int):
    """Update the queue size gauge.

    Args:
        queue_name: Name of the queue
        size: Current queue size
    """
    if PROMETHEUS_AVAILABLE:
        QUEUE_SIZE.labels(queue_name=queue_name).set(size)

def record_task_retry(task_name: str):
    """Record a task retry.

    Args:
        task_name: Name of the task
    """
    if PROMETHEUS_AVAILABLE:
        TASK_RETRY_COUNT.labels(task_name=task_name).inc()

def get_metrics_registry():
    """Get the Prometheus metrics registry for exposing metrics.

    Returns:
        Registry or None if prometheus_client not available
    """
    if PROMETHEUS_AVAILABLE:
        from prometheus_client import REGISTRY

        return REGISTRY
    return None
