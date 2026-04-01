"""Celery task wrappers for user workflows."""

from __future__ import annotations

import logging

from django.db import close_old_connections
from django.db.utils import InterfaceError, OperationalError

from apps.shared.celery import observed_shared_task
from apps.users.services.celery_tasks import UserTaskService
from apps.users.services.email_service import send_email_task

logger = logging.getLogger(__name__)

RETRYABLE_DB_ERRORS = (OperationalError, InterfaceError)


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
        return UserTaskService.process_import_job(job_id=job_id, **kwargs)
    except Exception as exc:
        logger.exception("Import job processing failed", extra={"job_id": job_id})
        UserTaskService.mark_import_job_failed(job_id=job_id, error_message=str(exc))
        if isinstance(exc, RETRYABLE_DB_ERRORS):
            close_old_connections()
            raise self.retry(exc=exc, countdown=60)
        return {"job_id": job_id, "status": "failed", "reason": "import_failed"}


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
        raise self.retry(exc=exc, countdown=60)


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
