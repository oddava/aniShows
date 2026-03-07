
from storages.backends.s3boto3 import S3Boto3Storage
from apps.shared.logger import logger

class MediaStorage(S3Boto3Storage):
    location = "media"
    file_overwrite = False

    _bucket_checked = False

    def _ensure_bucket_exists(self):
        """Create the bucket if it doesn't exist (idempotent)."""
        if MediaStorage._bucket_checked:
            return
        try:
            self.connection.meta.client.head_bucket(Bucket=self.bucket_name)
        except Exception:
            try:
                self.connection.meta.client.create_bucket(Bucket=self.bucket_name)
                logger.info("Created S3 bucket: %s", self.bucket_name)
            except Exception as e:
                logger.warning("Could not create bucket %s: %s", self.bucket_name, e)
                return
        MediaStorage._bucket_checked = True

    def save(self, name, content, max_length=None):
        self._ensure_bucket_exists()
        return super().save(name, content, max_length=max_length)