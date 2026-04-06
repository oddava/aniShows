import re
from dataclasses import dataclass

from django.db import transaction

from apps.shared.logger import logger
from apps.users.models import UserImportJob
from apps.users.tasks import process_import_job

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")


@dataclass(slots=True)
class ImportJobActionResult:
    payload: dict
    status_code: int


def is_valid_import_username(username: str | None) -> bool:
    return bool(username and USERNAME_PATTERN.match(username))


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
        job = UserImportJob.objects.create(
            user=user,
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
        job = UserImportJob.objects.create(
            user=user,
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
        job = UserImportJob.objects.create(
            user=user,
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
