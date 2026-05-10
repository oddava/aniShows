import re
from dataclasses import dataclass
import json

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ...shared.logger import logger
from ..models import UserImportJob
from ..tasks import process_import_job

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")
ACTIVE_IMPORT_STATUSES = (
    UserImportJob.ImportStatus.pending,
    UserImportJob.ImportStatus.processing,
)
DEFAULT_MAX_ACTIVE_IMPORT_JOBS_PER_USER = 1
DEFAULT_MAX_IMPORT_JOBS_PER_DAY = 5
DEFAULT_MAX_IMPORT_TASK_PAYLOAD_BYTES = 512 * 1024


@dataclass(slots=True)
class ImportJobActionResult:
    payload: dict
    status_code: int


def is_valid_import_username(username: str | None) -> bool:
    return bool(username and USERNAME_PATTERN.match(username))


def _task_payload_size_bytes(task_kwargs: dict) -> int:
    try:
        return len(json.dumps(task_kwargs, default=str).encode("utf-8"))
    except TypeError:
        return 10**12


def _validate_import_limits(user, task_kwargs: dict | None = None) -> ImportJobActionResult | None:
    max_active_jobs = getattr(
        settings,
        "MAX_ACTIVE_IMPORT_JOBS_PER_USER",
        DEFAULT_MAX_ACTIVE_IMPORT_JOBS_PER_USER,
    )
    max_daily_jobs = getattr(settings, "MAX_IMPORT_JOBS_PER_DAY", DEFAULT_MAX_IMPORT_JOBS_PER_DAY)
    max_task_payload_bytes = getattr(
        settings,
        "MAX_IMPORT_TASK_PAYLOAD_BYTES",
        DEFAULT_MAX_IMPORT_TASK_PAYLOAD_BYTES,
    )

    active_count = UserImportJob.objects.filter(
        user=user,
        status__in=ACTIVE_IMPORT_STATUSES,
    ).count()
    if active_count >= max_active_jobs:
        return ImportJobActionResult(
            payload={
                "detail": "You already have an import in progress.",
                "code": "import_already_running",
            },
            status_code=429,
        )

    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_count = UserImportJob.objects.filter(user=user, created_at__gte=today_start).count()
    if daily_count >= max_daily_jobs:
        return ImportJobActionResult(
            payload={
                "detail": "Daily import limit reached. Please try again tomorrow.",
                "code": "daily_import_limit_reached",
            },
            status_code=429,
        )

    if task_kwargs and _task_payload_size_bytes(task_kwargs) > max_task_payload_bytes:
        return ImportJobActionResult(
            payload={
                "detail": "Import payload is too large.",
                "code": "import_payload_too_large",
            },
            status_code=400,
        )

    return None


def _queue_import_job(job_id: int, **task_kwargs) -> None:
    def _enqueue():
        try:
            process_import_job.delay(job_id=job_id, **task_kwargs)
        except Exception:
            logger.exception("Failed to queue import job", extra={"job_id": job_id})
            try:
                job = UserImportJob.objects.get(id=job_id)
            except UserImportJob.DoesNotExist:
                logger.warning(
                    "Import job disappeared before queue failure could be persisted",
                    extra={"job_id": job_id},
                )
                return

            if job.status == UserImportJob.ImportStatus.pending:
                errors = list(job.errors or [])
                errors.append("Failed to queue import job")
                job.status = UserImportJob.ImportStatus.failed
                job.errors = errors[-10:]
                job.save(update_fields=["status", "errors"])

    transaction.on_commit(_enqueue)


def create_mal_import_job(user, username):
    with transaction.atomic():
        locked_user = user.__class__.objects.select_for_update().get(pk=user.pk)
        limit_error = _validate_import_limits(locked_user, {"username": username})
        if limit_error:
            return limit_error

        job = UserImportJob.objects.create(
            user=locked_user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier=username,
        )
        _queue_import_job(job.id, username=username)
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def create_mal_xml_import_job(user, file_name, xml_content):
    with transaction.atomic():
        locked_user = user.__class__.objects.select_for_update().get(pk=user.pk)
        limit_error = _validate_import_limits(locked_user, {"xml_content": xml_content})
        if limit_error:
            return limit_error

        job = UserImportJob.objects.create(
            user=locked_user,
            source=UserImportJob.ImportSource.myanimelist_xml,
            source_identifier=file_name,
        )
        _queue_import_job(job.id, xml_content=xml_content)
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def create_anilist_import_job(user, username, access_token):
    with transaction.atomic():
        locked_user = user.__class__.objects.select_for_update().get(pk=user.pk)
        limit_error = _validate_import_limits(
            locked_user,
            {"username": username, "access_token": access_token},
        )
        if limit_error:
            return limit_error

        job = UserImportJob.objects.create(
            user=locked_user,
            source=UserImportJob.ImportSource.anilist,
            source_identifier=username,
        )
        _queue_import_job(job.id, username=username, access_token=access_token)
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def cancel_import_job(job):
    if job.status not in [
        UserImportJob.ImportStatus.pending,
        UserImportJob.ImportStatus.processing,
    ]:
        return ImportJobActionResult(
            payload={"error": "Cannot cancel a job that is already completed or failed"},
            status_code=400,
        )

    job.status = UserImportJob.ImportStatus.failed
    job.errors.append("Cancelled by user")
    job.save(update_fields=["status", "errors"])
    return ImportJobActionResult(
        payload={"message": "Import job cancelled", "job_id": job.id},
        status_code=200,
    )
