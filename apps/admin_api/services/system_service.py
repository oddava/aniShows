"""The admin System page (G6 P1-3): queues, workers, beat, AniList budget, database.

Everything is read on demand and cached briefly; nothing here writes except the
superuser-only "run a beat entry now". Each section degrades on its own: a broker,
worker or database problem marks that section unavailable instead of failing the
page. The beat section reads the static ``CELERY_BEAT_SCHEDULE`` (the file
scheduler beat really runs), never a database copy.
"""

from __future__ import annotations

import datetime as dt
from contextlib import suppress
from dataclasses import dataclass
from numbers import Number

from celery import current_app
from celery.schedules import crontab, schedule
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, connection
from django.db.models import Max
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ...core.celery_signals import is_untracked, last_run_cache_key
from ...core.models import AuditLog, CeleryTaskResult
from ...core.services.celery_admin_service import create_task_result_record, routed_queue
from ...core.services.celery_monitoring import get_queue_sizes, routed_queue_names
from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from .audit import record_admin_action

SYSTEM_CACHE_KEY = "admin:system:v1"
SYSTEM_CACHE_SECONDS = 60
WORKERS_CACHE_KEY = "admin:system:workers:v1"
WORKERS_CACHE_SECONDS = 15
DATABASE_CACHE_KEY = "admin:system:database:v1"
DATABASE_CACHE_SECONDS = 300
MIGRATIONS_CACHE_KEY = "admin:system:migrations:v1"
MIGRATIONS_CACHE_SECONDS = 60
WORKER_TIMEOUT_SECONDS = 1.0
STALE_AFTER = dt.timedelta(minutes=15)
TOP_TABLES = 8
RECENT_FAILURES = 10
FAILURE_MESSAGE_LENGTH = 300
IN_FLIGHT_STATUSES = ("PENDING", "STARTED", "RETRY")
IN_FLIGHT_WINDOW = dt.timedelta(hours=12)
# The R7 accessors only read the cache; anything else is a contract break.
ACCESSOR_ERRORS = (*CACHE_ERRORS, AttributeError, TypeError, ValueError)


class SystemActionError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class BeatEntry:
    name: str
    task: str
    schedule: object
    args: tuple
    kwargs: dict
    queue: str


# --------------------------------------------------------------------- caching


def _cached(key: str, seconds: int, build, *, refresh: bool = False):
    if not refresh:
        with suppress(*CACHE_ERRORS):
            value = cache.get(key)
            if value is not None:
                return value
    value = build()
    with suppress(*CACHE_ERRORS):
        cache.set(key, value, timeout=seconds)
    return value


# ---------------------------------------------------------------------- queues


def queues_section() -> dict:
    names = routed_queue_names()
    sizes = get_queue_sizes(names)
    if sizes is None:
        return {"available": False, "items": []}
    return {"available": True, "items": [{"name": name, "size": sizes[name]} for name in names]}


# --------------------------------------------------------------------- workers


def _workers_now() -> dict:
    try:
        control = current_app.control
        replies = control.ping(timeout=WORKER_TIMEOUT_SECONDS) or []
        active = control.inspect(timeout=WORKER_TIMEOUT_SECONDS).active() or {}
    except ENQUEUE_ERRORS:
        logger.warning("Celery worker inspection failed", exc_info=True)
        return {"available": False, "items": [], "total": 0}
    names = sorted({name for reply in replies if isinstance(reply, dict) for name in reply})
    items = [{"name": name, "active_tasks": len(active.get(name) or [])} for name in names]
    return {"available": True, "items": items, "total": len(items)}


def workers_section(*, refresh: bool = False) -> dict:
    return _cached(WORKERS_CACHE_KEY, WORKERS_CACHE_SECONDS, _workers_now, refresh=refresh)


# ------------------------------------------------------------------------ beat


def _as_schedule(value):
    if isinstance(value, dt.timedelta):
        return schedule(run_every=value)
    if isinstance(value, Number):
        return schedule(run_every=dt.timedelta(seconds=float(value)))
    return value


def beat_entries() -> dict[str, BeatEntry]:
    entries = {}
    for name, spec in (settings.CELERY_BEAT_SCHEDULE or {}).items():
        task = spec["task"]
        options = spec.get("options") or {}
        entries[name] = BeatEntry(
            name=name,
            task=task,
            schedule=_as_schedule(spec["schedule"]),
            args=tuple(spec.get("args") or ()),
            kwargs=dict(spec.get("kwargs") or {}),
            queue=options.get("queue") or routed_queue(task),
        )
    return entries


def schedule_text(value) -> str:
    if isinstance(value, crontab):
        return " ".join(
            str(part)
            for part in (
                value._orig_minute,
                value._orig_hour,
                value._orig_day_of_month,
                value._orig_month_of_year,
                value._orig_day_of_week,
            )
        )
    if isinstance(value, schedule):
        return f"every {int(value.run_every.total_seconds())}s"
    return str(value)


def _last_runs(entries: dict[str, BeatEntry]) -> dict[str, dt.datetime]:
    tasks = {entry.task for entry in entries.values()}
    tracked = sorted(task for task in tasks if not is_untracked(task))
    last_runs = dict(
        CeleryTaskResult.objects.filter(task_name__in=tracked)
        .values("task_name")
        .annotate(last=Max("date_created"))
        .values_list("task_name", "last")
    )
    untracked = sorted(task for task in tasks if is_untracked(task))
    cached = {}
    with suppress(*CACHE_ERRORS):
        cached = cache.get_many([last_run_cache_key(task) for task in untracked])
    for task in untracked:
        stamp = parse_datetime(str(cached.get(last_run_cache_key(task)) or ""))
        if stamp is not None:
            last_runs[task] = stamp
    return last_runs


def beat_section() -> list[dict]:
    entries = beat_entries()
    last_runs = _last_runs(entries)
    now = timezone.now()
    rows = []
    for entry in entries.values():
        last_run = last_runs.get(entry.task)
        next_due = None
        stale = False
        if last_run is not None:
            with suppress(AttributeError, TypeError, ValueError):
                next_due = now + entry.schedule.remaining_estimate(last_run)
                stale = next_due < now - STALE_AFTER
        rows.append(
            {
                "name": entry.name,
                "task": entry.task,
                "kwargs": entry.kwargs,
                "schedule": schedule_text(entry.schedule),
                "queue": entry.queue,
                "last_run": last_run.isoformat() if last_run else None,
                "next_due": next_due.isoformat() if next_due else None,
                "stale": stale,
                "tracked": not is_untracked(entry.task),
            }
        )
    return rows


# --------------------------------------------------------------------- AniList


def anilist_section() -> dict:
    """The AniList budget through the read-only accessors (R7), if they exist yet.

    G6 must not read the limiter's cache keys itself, so without
    ``AniListRateLimiter.snapshot`` this reports ``available: False``.
    """
    try:
        from ...animes.services import rate_limiting
    except ImportError:
        return {"available": False}
    limiter_cls = getattr(rate_limiting, "AniListRateLimiter", None)
    if limiter_cls is None or not callable(getattr(limiter_cls, "snapshot", None)):
        return {"available": False}
    try:
        snapshot = dict(limiter_cls().snapshot())
    except ACCESSOR_ERRORS:
        logger.warning("AniList limiter snapshot failed", exc_info=True)
        return {"available": False}

    breaker = None
    breaker_cls = getattr(rate_limiting, "CircuitBreaker", None)
    if breaker_cls is not None and callable(getattr(breaker_cls, "state", None)):
        try:
            breaker = dict(
                breaker_cls("anilist_api", failure_threshold=5, recovery_timeout=300).state()
            )
        except ACCESSOR_ERRORS:
            logger.warning("AniList breaker state failed", exc_info=True)
    return {
        "available": True,
        "limit": snapshot.get("limit"),
        "used_this_minute": snapshot.get("used_this_minute"),
        "interactive_used": snapshot.get("interactive_used"),
        "paused_until": snapshot.get("paused_until"),
        "breaker": breaker,
    }


# -------------------------------------------------------------------- database


def _database_now() -> dict:
    if connection.vendor != "postgresql":
        return {"available": False, "size_bytes": None, "tables": []}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_database_size(current_database())")
            size_bytes = int(cursor.fetchone()[0])
            cursor.execute(
                "SELECT relname, pg_total_relation_size(relid) FROM pg_catalog.pg_statio_user_tables "
                "ORDER BY pg_total_relation_size(relid) DESC LIMIT %s",
                [TOP_TABLES],
            )
            tables = [{"name": name, "size_bytes": int(size)} for name, size in cursor.fetchall()]
    except DatabaseError:
        logger.warning("Database size query failed", exc_info=True)
        return {"available": False, "size_bytes": None, "tables": []}
    return {"available": True, "size_bytes": size_bytes, "tables": tables}


def database_section(*, refresh: bool = False) -> dict:
    return _cached(DATABASE_CACHE_KEY, DATABASE_CACHE_SECONDS, _database_now, refresh=refresh)


# ---------------------------------------------------------------------- health


def _migrations_pending() -> dict:
    from ...core.services.migration_health import has_pending_migrations

    try:
        return {"pending": bool(has_pending_migrations())}
    except DatabaseError:
        return {"pending": None}


def health_section(*, refresh: bool = False) -> dict:
    database_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        database_ok = False

    cache_ok = False
    with suppress(*CACHE_ERRORS):
        cache.set("admin:system:ping", "1", timeout=10)
        cache_ok = cache.get("admin:system:ping") == "1"

    migrations = (
        _cached(
            MIGRATIONS_CACHE_KEY, MIGRATIONS_CACHE_SECONDS, _migrations_pending, refresh=refresh
        )
        if database_ok
        else {"pending": None}
    )
    return {"database": database_ok, "cache": cache_ok, "migrations_pending": migrations["pending"]}


# -------------------------------------------------------------------- failures


def failures_section() -> list[dict]:
    rows = (
        CeleryTaskResult.objects.filter(status=CeleryTaskResult.TaskStatus.FAILURE)
        .order_by("-date_created")
        .values("id", "task_name", "date_created", "error_message")[:RECENT_FAILURES]
    )
    return [
        {
            "id": row["id"],
            "task_name": row["task_name"],
            "date_created": row["date_created"].isoformat(),
            "error_message": (row["error_message"] or "")[:FAILURE_MESSAGE_LENGTH],
        }
        for row in rows
    ]


# ---------------------------------------------------------------------- page


def _build_payload(refresh: bool) -> dict:
    return {
        "generated_at": timezone.now().isoformat(),
        "queues": queues_section(),
        "workers": workers_section(refresh=refresh),
        "beat": beat_section(),
        "anilist": anilist_section(),
        "database": database_section(refresh=refresh),
        "health": health_section(refresh=refresh),
        "failures": failures_section(),
    }


def build_system_payload(*, refresh: bool = False) -> dict:
    return _cached(
        SYSTEM_CACHE_KEY, SYSTEM_CACHE_SECONDS, lambda: _build_payload(refresh), refresh=refresh
    )


def run_beat_entry(request, entry_name: str) -> dict:
    """Send one beat entry's task now, with its configured args/kwargs only."""
    entry = beat_entries().get(entry_name)
    if entry is None:
        raise SystemActionError("Unknown beat entry.", 404)
    if not is_untracked(entry.task) and (
        CeleryTaskResult.objects.filter(
            task_name=entry.task,
            status__in=IN_FLIGHT_STATUSES,
            date_created__gte=timezone.now() - IN_FLIGHT_WINDOW,
        ).exists()
    ):
        raise SystemActionError("This task is already pending or running.", 409)

    result = current_app.send_task(
        entry.task, args=list(entry.args), kwargs=entry.kwargs, queue=entry.queue
    )
    if not is_untracked(entry.task):
        create_task_result_record(
            task_path=entry.task,
            task_id=result.id,
            args=list(entry.args),
            kwargs=entry.kwargs,
            queue=entry.queue,
            user=request.user,
        )
    record_admin_action(
        request,
        action=AuditLog.ActionType.TRIGGER,
        entity_type="BeatEntry",
        entity_id=entry.name[:50],
        entity_repr=f"Run {entry.name} now",
        metadata={"task": entry.task, "task_id": result.id, "kwargs": entry.kwargs},
    )
    with suppress(*CACHE_ERRORS):
        cache.delete(SYSTEM_CACHE_KEY)
    return {
        "entry": entry.name,
        "task": entry.task,
        "task_id": result.id,
        "message": f"{entry.name} queued.",
    }
