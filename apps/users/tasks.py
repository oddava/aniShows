"""Celery task wrappers for user workflows."""

from __future__ import annotations

import logging

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from ..shared.celery import observed_shared_task
from ..shared.task_lock import cache_lock
from .services.celery_tasks import UserTaskService

logger = logging.getLogger(__name__)

RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)
RETRYABLE_HTTP_STATUS_CODES = {429, 500, 502, 503, 504}


def _stats_refresh_cache_key(user_id: int) -> str:
    return f"user:stats:refresh:queued:{user_id}"


def schedule_user_stats_refresh(
    *,
    user_id: int | None,
    countdown: int = 0,
    queue: str | None = None,
    dedupe_ttl_seconds: int | None = None,
    force: bool = False,
):
    """Queue a per-user stats refresh with short-term deduplication."""
    if not user_id:
        return None

    resolved_countdown = max(int(countdown), 0)
    resolved_ttl = max(
        int(dedupe_ttl_seconds or settings.USER_STATS_REFRESH_DEDUPE_TTL_SECONDS),
        resolved_countdown + 15,
    )
    cache_key = _stats_refresh_cache_key(user_id)
    if not force and not cache.add(cache_key, True, timeout=resolved_ttl):
        return None

    try:
        kwargs = {"user_id": user_id}
        options = {"kwargs": kwargs}
        if resolved_countdown:
            options["countdown"] = resolved_countdown
        if queue:
            options["queue"] = queue
        return update_user_stats.apply_async(**options)
    except Exception:
        cache.delete(cache_key)
        raise


def _iter_exception_chain(exc: Exception):
    seen = set()
    current = exc
    while current and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__


def _can_retry(task, exc: Exception) -> bool:
    max_retries = getattr(task, "max_retries", 0)
    return task.request.retries < max_retries and max_retries > 0


def _is_retryable_external_error(exc: Exception) -> bool:
    for current in _iter_exception_chain(exc):
        if isinstance(current, RETRYABLE_DB_ERRORS):
            return True
        if isinstance(current, (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError)):
            return True
        if isinstance(current, httpx.HTTPStatusError) and current.response is not None:
            if current.response.status_code in RETRYABLE_HTTP_STATUS_CODES:
                return True
    return False


@observed_shared_task(retry_policy="standard")
def cleanup_unverified_accounts(self, days: int = 7):
    try:
        return UserTaskService.cleanup_unverified_accounts(days=days)
    except Exception as exc:
        logger.exception("Unverified account cleanup failed", extra={"days": days})
        raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard")
def process_import_job(self, job_id: int, **kwargs):
    try:
        return UserTaskService.process_import_job(
            job_id=job_id,
            allow_processing_resume=self.request.retries > 0,
            **kwargs,
        )
    except Exception as exc:
        logger.exception("Import job processing failed", extra={"job_id": job_id})
        if isinstance(exc, RETRYABLE_DB_ERRORS) and _can_retry(self, exc):
            close_old_connections()
            raise self.retry(exc=exc, countdown=60)
        UserTaskService.mark_import_job_failed(job_id=job_id, error_message=str(exc))
        raise


@observed_shared_task(retry_policy="external_api")
def fetch_anime_by_external_id(
    self,
    mal_id: int | None = None,
    anilist_id: int | None = None,
    title: str | None = None,
):
    try:
        anime_id = UserTaskService.fetch_anime_by_external_id(
            mal_id=mal_id,
            anilist_id=anilist_id,
            title=title,
        )
        return {"anime_id": anime_id, "mal_id": mal_id, "anilist_id": anilist_id, "title": title}
    except Exception as exc:
        logger.exception(
            "External anime fetch failed",
            extra={"mal_id": mal_id, "anilist_id": anilist_id, "title": title},
        )
        if _is_retryable_external_error(exc) and _can_retry(self, exc):
            if isinstance(exc, RETRYABLE_DB_ERRORS):
                close_old_connections()
            raise self.retry(exc=exc, countdown=60)
        raise


@observed_shared_task(retry_policy="standard")
def cleanup_old_import_jobs(self, days: int = 30):
    try:
        deleted = UserTaskService.cleanup_old_import_jobs(days=days)
        return {"deleted": deleted, "days": days}
    except Exception as exc:
        logger.exception("Old import job cleanup failed", extra={"days": days})
        raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard")
def run_user_maintenance_workflow(
    self,
    cleanup_unverified: bool = True,
    cleanup_imports: bool = True,
    unverified_days: int = 7,
    import_days: int = 30,
):
    try:
        return UserTaskService.run_user_maintenance_workflow(
            cleanup_unverified=cleanup_unverified,
            cleanup_imports=cleanup_imports,
            unverified_days=unverified_days,
            import_days=import_days,
        )
    except Exception as exc:
        logger.exception("User maintenance workflow failed to queue")
        raise self.retry(exc=exc)


@observed_shared_task(retry_policy="standard", time_limit_preset="quick")
def update_user_stats(self, user_id: int | None = None):
    try:
        return UserTaskService.update_user_stats(user_id=user_id)
    except Exception as exc:
        if isinstance(exc, RETRYABLE_DB_ERRORS):
            close_old_connections()
            logger.warning("Retrying user stats update after transient DB error", extra={"user_id": user_id})
        else:
            logger.exception("User stats update failed", extra={"user_id": user_id})
        raise self.retry(exc=exc, countdown=30)


@observed_shared_task(retry_policy="standard")
def update_all_user_stats(self):
    with cache_lock(
        "user:stats:backstop:lock",
        timeout=settings.USER_STATS_BACKSTOP_LOCK_SECONDS,
    ) as acquired:
        if not acquired:
            result = {"status": "skipped", "reason": "already_running"}
            logger.info("Skipped overlapping user stats backstop", extra=result)
            return result

        result = UserTaskService.queue_stale_user_stats_refreshes(
            stale_after_minutes=settings.USER_STATS_BACKSTOP_STALE_MINUTES,
            batch_size=settings.USER_STATS_BACKSTOP_BATCH_SIZE,
        )
        logger.info("Queued stale user stats refreshes", extra=result)
        return result


@observed_shared_task(retry_policy="standard")
def warm_profile_cache(self, usernames: list | None = None):
    try:
        return UserTaskService.warm_profile_cache(usernames=usernames)
    except Exception as exc:
        logger.exception("Profile cache warmup failed", extra={"usernames": usernames})
        raise self.retry(exc=exc)
