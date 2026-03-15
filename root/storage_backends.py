from django.conf import settings
from storages.backends.s3boto3 import S3Boto3Storage

from apps.shared.logger import logger


class MediaStorage(S3Boto3Storage):
    location = "media"
    file_overwrite = False

    _bucket_checked = False

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
        except Exception:
            pass

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
