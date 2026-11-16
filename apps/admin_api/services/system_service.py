"""The admin System page (G6 P1-3): queues, workers, beat, AniList budget, database.

Everything is read on demand and cached briefly; nothing here writes except the
superuser-only "run a beat entry now". Each section degrades on its own: a broker,
worker or database problem marks that section unavailable instead of failing the
page. The beat section reads the static ``CELERY_BEAT_SCHEDULE`` (the file
scheduler beat really runs), never a database copy.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from contextlib import suppress
from dataclasses import dataclass

from celery import current_app
from celery.schedules import crontab, schedule
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, connection
from django.db.models import Max, Min
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ...core.celery_signals import is_untracked, last_run_cache_key
from ...core.models import AuditLog, CeleryTaskResult
from ...core.services.celery_admin_service import (
    TaskAlreadyRunningError,
    enqueue_tracked_task,
    routed_queue,
)
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
# cleanup-task-results-daily keeps 7 days of task results.
TASK_RESULT_RETENTION = dt.timedelta(days=7)
UNTRACKED_RUN_CLAIM_PREFIX = "admin:system:run:"
UNTRACKED_RUN_CLAIM_SECONDS = 60
# The R7 accessors only read the cache; anything else is a contract break.
ACCESSOR_ERRORS: tuple[type[Exception], ...] = (
    *CACHE_ERRORS,
    AttributeError,
    TypeError,
    ValueError,
)


class SystemActionError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class BeatEntry:
    name: str
    task: str
    schedule: crontab | schedule
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


def _as_schedule(value) -> crontab | schedule:
    if isinstance(value, dt.timedelta):
        return schedule(run_every=value)
    if isinstance(value, int | float):
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


@dataclass(slots=True, frozen=True)
class RunHistory:
    """Last runs per beat entry, plus how far back the tracked history reaches."""

    last_runs: dict[str, dt.datetime]
    tracked_since: dt.datetime | None


def _kwargs_match(entry_kwargs: dict, row_kwargs) -> bool:
    """A result row belongs to an entry when it ran with (at least) the entry's kwargs.

    Only used when several entries share one task (``sync_anime_catalog`` with
    different ``sync_type``): the task name alone would credit an hourly run to a
    weekly entry. Entries with identical kwargs (``derive-airing-hourly`` and
    ``sync-popular-weekly``) cannot be told apart and share their last run.
    """
    if not isinstance(row_kwargs, dict):
        return not entry_kwargs
    return all(row_kwargs.get(key) == value for key, value in entry_kwargs.items())


def _run_history(entries: dict[str, BeatEntry]) -> RunHistory:
    tasks = {entry.task for entry in entries.values()}
    tracked = sorted(task for task in tasks if not is_untracked(task))
    groups = list(
        CeleryTaskResult.objects.filter(task_name__in=tracked)
        .values("task_name", "task_kwargs")
        .annotate(last=Max("date_created"), first=Min("date_created"))
        .order_by()
    )
    entries_per_task = Counter(entry.task for entry in entries.values())
    last_runs: dict[str, dt.datetime] = {}
    for entry in entries.values():
        if is_untracked(entry.task):
            continue
        shared = entries_per_task[entry.task] > 1
        matching = [
            group["last"]
            for group in groups
            if group["task_name"] == entry.task
            and (not shared or _kwargs_match(entry.kwargs, group["task_kwargs"]))
        ]
        if matching:
            last_runs[entry.name] = max(matching)

    untracked = {entry.name: entry.task for entry in entries.values() if is_untracked(entry.task)}
    cached: dict = {}
    with suppress(*CACHE_ERRORS):
        cached = cache.get_many([last_run_cache_key(task) for task in set(untracked.values())])
    for name, task in untracked.items():
        stamp = parse_datetime(str(cached.get(last_run_cache_key(task)) or ""))
        if stamp is not None:
            last_runs[name] = stamp

    oldest = min((group["first"] for group in groups), default=None)
    tracked_since = None
    if oldest is not None:
        tracked_since = max(oldest, timezone.now() - TASK_RESULT_RETENTION)
    return RunHistory(last_runs=last_runs, tracked_since=tracked_since)


def _next_due(entry: BeatEntry, since: dt.datetime, now: dt.datetime) -> dt.datetime | None:
    try:
        return now + entry.schedule.remaining_estimate(since)
    except (AttributeError, TypeError, ValueError):
        return None


def beat_section() -> list[dict]:
    """Every beat entry with its last run, next due time and whether it is overdue.

    ``stale`` means more than 15 minutes past due. A tracked entry with no run in the
    retained result history is stale too if it should have run since that history
    begins (results are pruned after 7 days), so a missed weekly run is not hidden
    as "never". A fresh install with no history flags nothing.
    """
    entries = beat_entries()
    history = _run_history(entries)
    now = timezone.now()
    rows = []
    for entry in entries.values():
        last_run = history.last_runs.get(entry.name)
        tracked = not is_untracked(entry.task)
        next_due = None
        stale = False
        if last_run is not None:
            next_due = _next_due(entry, last_run, now)
        elif tracked and history.tracked_since is not None:
            missed = _next_due(entry, history.tracked_since, now)
            stale = missed is not None and missed < now - STALE_AFTER
        if next_due is not None:
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
                "tracked": tracked,
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


def _run_untracked(entry: BeatEntry) -> str:
    """Send an untracked entry, at most once a minute (a cache claim; no result rows).

    If the cache is down the run goes ahead unclaimed (these tasks are idempotent
    every-minute jobs); if the send fails, the claim is released for a retry.
    """
    claim_key = f"{UNTRACKED_RUN_CLAIM_PREFIX}{entry.name}"
    try:
        claimed = bool(cache.add(claim_key, 1, UNTRACKED_RUN_CLAIM_SECONDS))
    except CACHE_ERRORS:
        logger.warning("Run-now claim unavailable; sending unclaimed", extra={"entry": entry.name})
        claimed, claim_key = True, ""
    if not claimed:
        raise SystemActionError("This task was run moments ago.", 409)
    try:
        return current_app.send_task(
            entry.task, args=list(entry.args), kwargs=entry.kwargs, queue=entry.queue
        ).id
    except Exception:
        if claim_key:
            with suppress(*CACHE_ERRORS):
                cache.delete(claim_key)
        raise


def run_beat_entry(request, entry_name: str) -> dict:
    """Send one beat entry's task now, with its configured args/kwargs only.

    Tracked tasks go through the exclusive enqueue (409 while one is pending or
    running, safe against concurrent clicks). Untracked every-minute tasks have no
    result rows, so a one-minute cache claim stops repeated runs instead.
    """
    entry = beat_entries().get(entry_name)
    if entry is None:
        raise SystemActionError("Unknown beat entry.", 404)

    if is_untracked(entry.task):
        task_id = _run_untracked(entry)
    else:
        try:
            task_id = enqueue_tracked_task(
                task_path=entry.task,
                args=list(entry.args),
                kwargs=entry.kwargs,
                queue=entry.queue,
                user=request.user,
                exclusive=True,
            ).task_id
        except TaskAlreadyRunningError as exc:
            raise SystemActionError("This task is already pending or running.", 409) from exc

    record_admin_action(
        request,
        action=AuditLog.ActionType.TRIGGER,
        entity_type="BeatEntry",
        entity_id=entry.name,
        entity_repr=f"Run {entry.name} now",
        metadata={"task": entry.task, "task_id": task_id, "kwargs": entry.kwargs},
    )
    with suppress(*CACHE_ERRORS):
        cache.delete(SYSTEM_CACHE_KEY)
    return {
        "entry": entry.name,
        "task": entry.task,
        "task_id": task_id,
        "message": f"{entry.name} queued.",
    }
