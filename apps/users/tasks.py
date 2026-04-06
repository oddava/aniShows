"""Celery task wrappers for user workflows."""

from __future__ import annotations

import logging

import httpx
from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from apps.shared.celery import observed_shared_task
from apps.users.services.celery_tasks import UserTaskService
from apps.users.services.email_service import send_email_task

logger = logging.getLogger(__name__)

RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)
RETRYABLE_HTTP_STATUS_CODES = {429, 500, 502, 503, 504}


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
    queued_task = update_user_stats.apply_async()
    result = {"status": "queued", "task_id": queued_task.id}
    logger.info("Queued full user stats refresh", extra=result)
    return result


@observed_shared_task(retry_policy="standard")
def warm_profile_cache(self, usernames: list | None = None):
    try:
        return UserTaskService.warm_profile_cache(usernames=usernames)
    except Exception as exc:
        logger.exception("Profile cache warmup failed", extra={"usernames": usernames})
        raise self.retry(exc=exc)
