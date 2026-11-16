"""Linked AniList account: pull-only sync (spec 3 P1-10, decision D-5).

- ``PUT import/anilist/link/`` saves the username (and the opt-in ``auto_sync``); a new
  link or a changed name queues a full import.
- ``POST import/anilist/sync/`` queues an incremental job: only entries AniList changed
  since the stored cursor (usually one request). One per user per 15 minutes.
- The daily maintenance workflow runs ``sync_linked_lists``: links with ``auto_sync``,
  owners seen in the last 14 days, fewer than 5 failures in a row, at most
  ``ANILIST_DAILY_SYNC_MAX_LINKS`` per run, one after another through the background
  budget. Nothing is ever pushed to AniList and no AniList credential is stored.
"""

from __future__ import annotations

import contextlib
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from django.core.cache import cache
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from ....shared.errors import CACHE_ERRORS
from ....shared.logger import logger
from ...models import UserImportJob, UserListLink

SYNC_COOLDOWN_SECONDS = 15 * 60
MAX_CONSECUTIVE_FAILURES = 5
ANILIST_DAILY_SYNC_MAX_LINKS = 300
DAILY_SYNC_ACTIVE_DAYS = 14


def _cooldown_key(user_id: int) -> str:
    return f"anilist_sync_cooldown:{user_id}"


def _cooldown_until(user_id: int) -> float | None:
    try:
        value = cache.get(_cooldown_key(user_id))
    except CACHE_ERRORS:
        return None
    try:
        until = float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    return until if until and until > time.time() else None


def _last_job(user) -> UserImportJob | None:
    return (
        UserImportJob.objects.filter(user=user, source=UserImportJob.ImportSource.anilist)
        .order_by("-created_at", "-id")
        .first()
    )


def link_payload(link: UserListLink | None, user) -> dict[str, Any]:
    from ....animes.serializers.imports import UserImportJobSerializer

    if link is None:
        return {"linked": False}
    until = _cooldown_until(user.id)
    last_job = _last_job(user)
    return {
        "linked": True,
        "username": link.external_username,
        "auto_sync": link.auto_sync,
        "last_synced_at": link.last_synced_at.isoformat() if link.last_synced_at else None,
        "last_error": link.last_error,
        "consecutive_failures": link.consecutive_failures,
        "auto_sync_paused": link.consecutive_failures >= MAX_CONSECUTIVE_FAILURES,
        "sync_available_at": (datetime.fromtimestamp(until, tz=UTC).isoformat() if until else None),
        "last_job": UserImportJobSerializer(last_job).data if last_job else None,
    }


def get_link(user) -> UserListLink | None:
    return UserListLink.objects.filter(user=user, provider=UserListLink.Provider.anilist).first()


def save_link(user, username: str, auto_sync: bool) -> dict[str, Any]:
    """Create or update the link; a new or renamed link queues a full import.

    Re-saving also clears the failure streak, which re-enables a paused auto-sync.
    """
    from ..import_job_service import create_anilist_import_job

    with transaction.atomic():
        link = UserListLink.objects.select_for_update().filter(user=user).first()
        renamed = link is None or link.external_username.lower() != username.lower()
        if link is None:
            link = UserListLink(user=user, provider=UserListLink.Provider.anilist)
        link.external_username = username
        link.auto_sync = bool(auto_sync)
        link.consecutive_failures = 0
        link.last_error = ""
        if renamed:
            link.cursor_updated_at = None
            link.last_synced_at = None
            link.external_user_id = None
        link.save()

    job_id = None
    import_error = None
    if renamed:
        result = create_anilist_import_job(user, username, mode=UserImportJob.ImportMode.full)
        if result.status_code == 202:
            job_id = result.payload["job_id"]
        else:
            import_error = result.payload
    return {**link_payload(link, user), "job_id": job_id, "import_error": import_error}


def delete_link(user) -> None:
    """Unlink; the imported list entries stay."""
    UserListLink.objects.filter(user=user).delete()


def request_sync(user):
    """``POST import/anilist/sync/``: an incremental job, at most one per 15 minutes."""
    from ..import_job_service import ImportJobActionResult, create_anilist_import_job

    link = get_link(user)
    if link is None:
        return ImportJobActionResult(
            payload={"detail": "Link your AniList account first.", "code": "anilist_not_linked"},
            status_code=404,
        )
    until = time.time() + SYNC_COOLDOWN_SECONDS
    try:
        claimed = cache.add(_cooldown_key(user.id), until, timeout=SYNC_COOLDOWN_SECONDS)
    except CACHE_ERRORS:
        claimed = True  # no cache: the active/daily job limits still apply
    if not claimed:
        remaining = int((_cooldown_until(user.id) or time.time()) - time.time())
        return ImportJobActionResult(
            payload={
                "detail": "You synced recently. Try again in a few minutes.",
                "code": "sync_cooldown",
                "retry_after": max(remaining, 1),
            },
            status_code=429,
        )
    result = create_anilist_import_job(
        user, link.external_username, mode=UserImportJob.ImportMode.incremental
    )
    if result.status_code != 202:
        with contextlib.suppress(*CACHE_ERRORS):
            cache.delete(_cooldown_key(user.id))  # nothing was queued: do not block a retry
    return result


def due_links(now=None):
    now = now or timezone.now()
    return (
        UserListLink.objects.filter(
            provider=UserListLink.Provider.anilist,
            auto_sync=True,
            consecutive_failures__lt=MAX_CONSECUTIVE_FAILURES,
            user__is_active=True,
            user__last_login__gte=now - timedelta(days=DAILY_SYNC_ACTIVE_DAYS),
        )
        .select_related("user")
        .order_by(F("last_synced_at").asc(nulls_first=True), "id")[:ANILIST_DAILY_SYNC_MAX_LINKS]
    )


def _claim_sync_job(link: UserListLink) -> UserImportJob | None:
    """Create the daily job under the same user lock as a manual import, or ``None``.

    A user with an import already running is skipped (it syncs tomorrow), so the
    daily step can never race a manual import into two active jobs.
    """
    user_model = link.user.__class__
    with transaction.atomic():
        user_model.objects.select_for_update().filter(pk=link.user_id).first()
        if UserImportJob.objects.filter(
            user_id=link.user_id,
            status__in=(UserImportJob.ImportStatus.pending, UserImportJob.ImportStatus.processing),
        ).exists():
            return None
        return UserImportJob.objects.create(
            user=link.user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier=link.external_username,
            mode=UserImportJob.ImportMode.incremental,
            status=UserImportJob.ImportStatus.processing,
            started_at=timezone.now(),
        )


def sync_linked_lists(*, importer_factory=None) -> dict[str, int]:
    """The daily step: incremental sync of each due link, sequentially, in this task.

    A link whose owner has an import running is skipped (it syncs tomorrow). The
    limiter spaces the requests; the soft time limit stops the loop cleanly.
    """
    from .anilist import AniListImporter

    factory = importer_factory or (lambda job, link: AniListImporter(job, link.external_username))
    counts = {"synced": 0, "failed": 0, "skipped": 0}
    for link in due_links():
        job = _claim_sync_job(link)
        if job is None:
            counts["skipped"] += 1
            continue
        try:
            result = factory(job, link).run()
        except SoftTimeLimitExceeded:
            counts["failed"] += 1
            logger.warning("Daily AniList sync stopped at the time limit", extra=counts)
            break
        except Exception as exc:
            counts["failed"] += 1
            logger.exception("Daily AniList sync failed", extra={"link_id": link.pk})
            # No task retry here: end the job now rather than leave it processing.
            from ..celery_tasks import UserTaskService

            UserTaskService.mark_import_job_failed(job_id=job.pk, error_message=str(exc))
            continue
        counts["synced" if result.get("outcome") == "completed" else "failed"] += 1
    logger.info("Daily AniList sync finished", extra=counts)
    return counts
