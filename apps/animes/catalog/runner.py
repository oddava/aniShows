"""Run one lane: a lock so a lane never overlaps itself, and one ``CatalogRun`` row."""

from __future__ import annotations

import time
from datetime import timedelta
from typing import Any

from django.core.cache import cache
from django.utils import timezone

from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from ..models import CatalogRun
from .hooks import bulk_catalog_write
from .lanes import LANES, LaneContext, LaneStoppedError, hydrate_candidates, load_cursor

# How long one run may work before it saves its place and stops. Production runs a
# single Celery process, so a long run would hold up list imports and notifications:
# the sweep works in short slices and queues the next one behind whatever is waiting.
RUN_BUDGET_SECONDS = {"seed": 4 * 60, "delta": 4 * 60}
DEFAULT_RUN_BUDGET_SECONDS = 5 * 60
LOCK_SECONDS = 60 * 60
# Run log retention: about 300 runs a day, so a month is plenty for the admin page.
RUN_RETENTION = timedelta(days=30)

# The worker queue each lane runs on. The beat entries (root/settings/celery_schedule.py)
# name the same queues; the admin "Run now", the CLI and a sweep's next slice use this.
LANE_QUEUES = {
    "trending": "high_priority",
    "airing": "high_priority",
    "seasons": "default",
    "delta": "default",
    "hydrate": "low_priority",
    "seed": "batch",
}


def _lock_key(lane: str) -> str:
    return f"catalog:lane-lock:{lane}"


def is_running(lane: str) -> bool:
    try:
        return cache.get(_lock_key(lane)) is not None
    except CACHE_ERRORS:
        return False


def run_lane(
    lane: str,
    *,
    trigger: str = CatalogRun.Trigger.SCHEDULE,
    user_id: int | None = None,
    **options: Any,
) -> dict[str, Any]:
    if lane not in LANES:
        raise ValueError(f"Unknown catalog lane: {lane}")
    idle = _idle_reason(lane, options)
    if idle:
        # Nothing to do: no run row, so the log shows work, not heartbeats.
        return {"lane": lane, "status": "skipped", "reason": idle}
    try:
        locked = cache.add(_lock_key(lane), timezone.now().isoformat(), timeout=LOCK_SECONDS)
    except CACHE_ERRORS:
        locked = True  # no cache, no lock: better to run than to never run
    if not locked:
        return {"lane": lane, "status": "skipped", "reason": "already_running"}

    from ..services.anilist import AniListService

    run = CatalogRun.objects.create(lane=lane, trigger=trigger, triggered_by=user_id)
    service = AniListService(enable_caching=False, enable_rate_limiting=True)
    budget = RUN_BUDGET_SECONDS.get(lane, DEFAULT_RUN_BUDGET_SECONDS)
    ctx = LaneContext(run=run, service=service, deadline=time.monotonic() + budget)
    status, error = CatalogRun.Status.SUCCEEDED, ""
    try:
        with bulk_catalog_write():
            LANES[lane](ctx, **options)
        if ctx.continue_later:
            status = CatalogRun.Status.PARTIAL
    except LaneStoppedError as exc:
        status = CatalogRun.Status.PARTIAL if ctx.fetched else CatalogRun.Status.FAILED
        error = _describe_stop(exc)
        logger.warning("Catalog lane stopped", extra={"lane": lane, "reason": str(exc)})
    except Exception as exc:
        status, error = CatalogRun.Status.FAILED, f"Unexpected error: {exc}"[:2000]
        logger.exception("Catalog lane failed", extra={"lane": lane, "run_id": run.pk})
    finally:
        service.close()
        CatalogRun.objects.filter(pk=run.pk).update(
            status=status,
            finished_at=timezone.now(),
            requests=ctx.requests,
            fetched=ctx.fetched,
            created=ctx.created,
            updated=ctx.updated,
            excluded=ctx.excluded,
            detail=ctx.detail,
            error=error,
        )
        try:
            cache.delete(_lock_key(lane))
        except CACHE_ERRORS:
            logger.debug("Could not release the catalog lane lock", exc_info=True)

    if ctx.created:
        _after_new_rows()
    if lane == "seasons":
        _prune_old_runs()
    if ctx.continue_later:
        _continue(lane, options)
    return {
        "lane": lane,
        "run_id": run.pk,
        "status": status,
        "requests": ctx.requests,
        "created": ctx.created,
        "updated": ctx.updated,
        "excluded": ctx.excluded,
    }


def _idle_reason(lane: str, options: dict) -> str:
    """Why a scheduled run has nothing to do, or "" (it runs)."""
    if lane == "seed" and not options.get("restart"):
        if load_cursor("seed").get("phase") == "done":
            return "sweep_done"
    if lane == "hydrate" and not options.get("anime_ids") and not hydrate_candidates(1):
        return "nothing_to_hydrate"
    return ""


def _prune_old_runs() -> None:
    CatalogRun.objects.filter(started_at__lt=timezone.now() - RUN_RETENTION).delete()


def _describe_stop(exc: LaneStoppedError) -> str:
    messages = {
        "rate_limited": "AniList asked us to slow down. The next run continues from here.",
        "transport_error": "AniList did not answer. The next run continues from here.",
        "query_rejected": "AniList rejected the query. Check the logs.",
        "too_few_results": "AniList returned too few trending titles; the old ranks were kept.",
    }
    return messages.get(exc.code, str(exc))[:2000]


def _after_new_rows() -> None:
    """New rows may be the missing end of other rows' franchise links."""
    from ..services.relation_links import link_pending_relations

    try:
        link_pending_relations()
    except Exception:  # noqa: BLE001 - the run already succeeded; the daily job retries
        logger.warning("Could not link pending relations after a catalog run", exc_info=True)


def _continue(lane: str, options: dict) -> None:
    from ..tasks.catalog import run_catalog_lane

    try:
        run_catalog_lane.apply_async(
            kwargs={"lane": lane, "trigger": CatalogRun.Trigger.CHAIN, **options},
            queue=LANE_QUEUES.get(lane, "default"),
            countdown=30,
        )
    except ENQUEUE_ERRORS:
        logger.warning("Could not queue the next catalog run", extra={"lane": lane}, exc_info=True)
