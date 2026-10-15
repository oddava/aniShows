import mimetypes

from django.conf import settings
from storages.backends.s3boto3 import S3Boto3Storage

from apps.shared.logger import logger

# python:3.12-slim has no /etc/mime.types, so WebP/AVIF uploads would get no
# Content-Type and be served as application/octet-stream.
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")

try:
    from botocore.exceptions import ClientError
except Exception:  # pragma: no cover - botocore is available in runtime environments
    ClientError = None


class MediaStorage(S3Boto3Storage):
    location = "media"
    file_overwrite = False

    _bucket_checked = False

    @staticmethod
    def _is_missing_bucket_error(exc: Exception) -> bool:
        if ClientError is not None and isinstance(exc, ClientError):
            error_code = str(exc.response.get("Error", {}).get("Code", "")).lower()
            status_code = str(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))
            return error_code in {"404", "no such bucket", "nosuchbucket", "notfound"} or status_code == "404"
        return False

    def _ensure_bucket_exists(self):
        """
        Create the bucket if it doesn't exist (idempotent).

        Disabled by default in request paths to avoid blocking uploads on bucket probes.
        """
        if MediaStorage._bucket_checked or not getattr(
            settings, "S3_RUNTIME_BUCKET_AUTOCREATE", False
        ):
            return

        # Mark as checked before network calls so repeated failures don't stall each upload.
        MediaStorage._bucket_checked = True

        try:
            self.connection.meta.client.head_bucket(Bucket=self.bucket_name)
            return
        except Exception as exc:
            if not self._is_missing_bucket_error(exc):
                logger.warning(
                    "Could not verify S3 bucket %s before save; skipping auto-create",
                    self.bucket_name,
                    exc_info=True,
                )
                return

        try:
            self.connection.meta.client.create_bucket(Bucket=self.bucket_name)
            logger.info("Created S3 bucket: %s", self.bucket_name)
        except Exception as exc:
            logger.warning("Could not create bucket %s: %s", self.bucket_name, exc)

    def save(self, name, content, max_length=None):
        # Runtime bucket auto-creation is opt-in to keep profile/avatar updates fast.
        if getattr(settings, "S3_RUNTIME_BUCKET_AUTOCREATE", False):
            self._ensure_bucket_exists()
        return super().save(name, content, max_length=max_length)
