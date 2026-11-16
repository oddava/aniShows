"""Celery task wrappers for user workflows."""

from __future__ import annotations

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from ..shared.celery import observed_shared_task, retry_on_error
from ..shared.logger import logger
from ..shared.task_lock import cache_lock
from .services.auth_service import flush_expired_tokens
from .services.celery_tasks import UserTaskService

RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)


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


def _can_retry(task, exc: Exception) -> bool:
    max_retries = getattr(task, "max_retries", 0)
    return task.request.retries < max_retries and max_retries > 0


@observed_shared_task(retry_policy="standard")
def cleanup_unverified_accounts(self, days: int = 7):
    with retry_on_error(self, "Unverified account cleanup failed", extra={"days": days}):
        return UserTaskService.cleanup_unverified_accounts(days=days)


@observed_shared_task(retry_policy="standard")
def flush_expired_auth_tokens(self, batch_size: int = 5000):
    """Delete expired JWT outstanding/blacklist rows (A20).

    No beat entry of its own: G3's run_user_maintenance_workflow queues it.
    """
    with retry_on_error(self, "Expired auth token flush failed", extra={"batch_size": batch_size}):
        return {"deleted": flush_expired_tokens(batch_size=batch_size)}


@observed_shared_task(retry_policy="standard", time_limit_preset="long")
def process_import_job(self, job_id: int, **kwargs):
    try:
        return UserTaskService.process_import_job(
            job_id=job_id,
            allow_processing_resume=self.request.retries > 0,
            **kwargs,
        )
    except SoftTimeLimitExceeded:
        # The importer already failed the job with how far it got; never retried.
        logger.warning("Import job hit its time limit", extra={"job_id": job_id})
        raise
    except Exception as exc:
        logger.exception("Import job processing failed", extra={"job_id": job_id})
        if isinstance(exc, RETRYABLE_DB_ERRORS) and _can_retry(self, exc):
            close_old_connections()
            raise self.retry(exc=exc, countdown=60)
        UserTaskService.mark_import_job_failed(job_id=job_id, error_message=str(exc))
        raise


@observed_shared_task(retry_policy="standard")
def cleanup_old_import_jobs(self, days: int = 30):
    with retry_on_error(self, "Old import job cleanup failed", extra={"days": days}):
        deleted = UserTaskService.cleanup_old_import_jobs(days=days)
        return {"deleted": deleted, "days": days}


@observed_shared_task(retry_policy="standard")
def run_user_maintenance_workflow(
    self,
    cleanup_unverified: bool = True,
    cleanup_imports: bool = True,
    unverified_days: int = 7,
    import_days: int = 30,
    sync_anilist: bool = True,
):
    with retry_on_error(self, "User maintenance workflow failed to queue"):
        return UserTaskService.run_user_maintenance_workflow(
            cleanup_unverified=cleanup_unverified,
            cleanup_imports=cleanup_imports,
            unverified_days=unverified_days,
            import_days=import_days,
            sync_anilist=sync_anilist,
        )


@observed_shared_task(retry_policy="none", time_limit_preset="long")
def sync_linked_anilist_lists(self):
    """The daily pull of opted-in linked AniList lists (queued by the maintenance workflow)."""
    return UserTaskService.sync_linked_anilist_lists()


@observed_shared_task(retry_policy="standard", time_limit_preset="quick")
def update_user_stats(self, user_id: int | None = None):
    try:
        return UserTaskService.update_user_stats(user_id=user_id)
    except Exception as exc:
        if isinstance(exc, RETRYABLE_DB_ERRORS):
            close_old_connections()
            logger.warning(
                "Retrying user stats update after transient DB error", extra={"user_id": user_id}
            )
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
