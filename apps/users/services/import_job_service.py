import re
from dataclasses import dataclass

from apps.users.models import UserImportJob
from apps.users.tasks import process_import_job

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,50}$")


@dataclass(slots=True)
class ImportJobActionResult:
    payload: dict
    status_code: int


def is_valid_import_username(username: str | None) -> bool:
    return bool(username and USERNAME_PATTERN.match(username))


def create_mal_import_job(user, username):
    job = UserImportJob.objects.create(
        user=user,
        source=UserImportJob.ImportSource.myanimelist_api,
        source_identifier=username,
    )
    process_import_job.delay(job_id=job.id, username=username)
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def create_mal_xml_import_job(user, file_name, xml_content):
    job = UserImportJob.objects.create(
        user=user,
        source=UserImportJob.ImportSource.myanimelist_xml,
        source_identifier=file_name,
    )
    process_import_job.delay(job_id=job.id, xml_content=xml_content)
    return ImportJobActionResult(
        payload={"message": "Import started", "job_id": job.id, "status": "pending"},
        status_code=202,
    )


def create_anilist_import_job(user, username, access_token):
    job = UserImportJob.objects.create(
        user=user,
        source=UserImportJob.ImportSource.anilist,
        source_identifier=username,
    )
    process_import_job.delay(job_id=job.id, username=username, access_token=access_token)
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
