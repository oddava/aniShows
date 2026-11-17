import re
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ...shared.celery import redact_task_kwargs
from ...shared.logger import logger
from ..models import UserImportJob
from ..tasks import process_import_job
from .import_service.entries import ImportedEntry

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")
ACTIVE_IMPORT_STATUSES = (
    UserImportJob.ImportStatus.pending,
    UserImportJob.ImportStatus.processing,
)


@dataclass(slots=True)
class ImportJobActionResult:
    payload: dict
    status_code: int


def is_valid_import_username(username: str | None) -> bool:
    return bool(username and USERNAME_PATTERN.match(username))


def _validate_import_limits(user) -> ImportJobActionResult | None:
    """One active job and ``MAX_IMPORT_JOBS_PER_DAY`` per user.

    Task kwargs carry only ids and usernames now (file entries live on the job), so
    there is no broker payload limit to check.
    """
    active_count = UserImportJob.objects.filter(
        user=user,
        status__in=ACTIVE_IMPORT_STATUSES,
    ).count()
    if active_count >= settings.MAX_ACTIVE_IMPORT_JOBS_PER_USER:
        return ImportJobActionResult(
            payload={
                "detail": "You already have an import in progress.",
                "code": "import_already_running",
            },
            status_code=429,
        )

    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_count = UserImportJob.objects.filter(user=user, created_at__gte=today_start).count()
    if daily_count >= settings.MAX_IMPORT_JOBS_PER_DAY:
        return ImportJobActionResult(
            payload={
                "detail": "Daily import limit reached. Please try again tomorrow.",
                "code": "daily_import_limit_reached",
            },
            status_code=429,
        )

    return None


def _queue_import_job(job_id: int, **task_kwargs) -> None:
    def _enqueue():
        try:
            kwargs = {"job_id": job_id, **task_kwargs}
            process_import_job.apply_async(
                kwargs=kwargs, kwargsrepr=repr(redact_task_kwargs(kwargs))
            )
        except Exception:
            logger.exception("Failed to queue import job", extra={"job_id": job_id})
            UserImportJob.objects.filter(
                id=job_id, status=UserImportJob.ImportStatus.pending
            ).update(
                status=UserImportJob.ImportStatus.failed,
                failure_reason="The import could not be started. Please try again.",
                errors=["Failed to queue import job"],
                payload=None,
            )

    transaction.on_commit(_enqueue)


def _started(job: UserImportJob) -> ImportJobActionResult:
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def _create_job(user, *, source, source_identifier, mode=UserImportJob.ImportMode.full, **fields):
    """Lock the user, check the limits, create the job and queue it on commit."""
    with transaction.atomic():
        locked_user = user.__class__.objects.select_for_update().get(pk=user.pk)
        limit_error = _validate_import_limits(locked_user)
        if limit_error:
            return limit_error, None
        job = UserImportJob.objects.create(
            user=locked_user,
            source=source,
            source_identifier=source_identifier,
            mode=mode,
            **fields,
        )
        _queue_import_job(job.id)
    return None, job


def create_mal_import_job(user, username):
    error, job = _create_job(
        user, source=UserImportJob.ImportSource.myanimelist_api, source_identifier=username
    )
    return error or _started(job)


def create_mal_xml_import_job(user, file_name: str, entries: list[ImportedEntry]):
    error, job = _create_job(
        user,
        source=UserImportJob.ImportSource.myanimelist_xml,
        source_identifier=file_name[:255],
        payload={"entries": [entry.to_payload() for entry in entries]},
    )
    return error or _started(job)


def create_anilist_import_job(user, username, *, mode=UserImportJob.ImportMode.full):
    """Queue an AniList import. No credential is accepted or forwarded (P0-5)."""
    error, job = _create_job(
        user,
        source=UserImportJob.ImportSource.anilist,
        source_identifier=username,
        mode=mode,
    )
    return error or _started(job)


def cancel_import_job(job):
    """Stop a pending or processing job; the running importer sees it on its next flush."""
    cancelled = UserImportJob.objects.filter(pk=job.pk, status__in=ACTIVE_IMPORT_STATUSES).update(
        status=UserImportJob.ImportStatus.cancelled,
        completed_at=timezone.now(),
        payload=None,
    )
    if not cancelled:
        return ImportJobActionResult(
            payload={
                "detail": "This import has already finished.",
                "code": "import_job_not_active",
            },
            status_code=400,
        )
    return ImportJobActionResult(
        payload={"message": "Import job cancelled", "job_id": job.id},
        status_code=200,
    )
