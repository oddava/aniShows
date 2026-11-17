"""Prove the app can use its object storage, with the app's own credentials.

    python manage.py s3_check

The deploy runs it before changing anything: the media bucket lives on the
host's RustFS, outside this stack, so a missing ``anishows-s3`` network, a
wrong credential or a bucket that was never provisioned must stop the deploy
here rather than show up as broken images. It checks that the bucket exists
(head_bucket), then writes, reads back and deletes a probe object under
``media/`` (the prefix the app writes to), so a read-only user fails too.
Exit status is non-zero, with the reason, on any failure.
"""

import time

from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

PROBE_BODY = b"anishows deploy probe"

HINT = (
    "Is the anishows-s3 network attached to rustfs (S3_NETWORK in .env)? "
    "Are the AWS_* values right (AWS_S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, "
    "AWS_SECRET_ACCESS_KEY, AWS_STORAGE_BUCKET_NAME, AWS_S3_REGION_NAME)? "
    "Does the bucket exist, and may that user read and write media/?"
)


def _client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_S3_REGION_NAME or None,
        config=Config(
            s3={"addressing_style": settings.AWS_S3_ADDRESSING_STYLE},
            connect_timeout=5,
            read_timeout=15,
            retries={"max_attempts": 1, "mode": "standard"},
        ),
    )


class Command(BaseCommand):
    help = "Check the S3 bucket: head_bucket, then put/get/delete a probe object under media/"

    def handle(self, *args, **options):
        if not getattr(settings, "USE_S3", False):
            raise CommandError("USE_S3 is not True: the app is not using object storage.")

        bucket = settings.AWS_STORAGE_BUCKET_NAME
        if not bucket:
            raise CommandError(f"AWS_STORAGE_BUCKET_NAME is empty. {HINT}")
        endpoint = settings.AWS_S3_ENDPOINT_URL or "AWS S3"
        key = f"{settings.PUBLIC_MEDIA_LOCATION}/.deploy-probe-{int(time.time())}"
        client = _client()
        step = "head_bucket"
        try:
            client.head_bucket(Bucket=bucket)
            self.stdout.write(self.style.SUCCESS(f"ok  head_bucket {bucket} at {endpoint}"))
            step = "put_object"
            client.put_object(Bucket=bucket, Key=key, Body=PROBE_BODY)
            step = "get_object"
            body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
            if body != PROBE_BODY:
                raise CommandError(f"get_object returned different bytes for {key}. {HINT}")
            step = "delete_object"
            client.delete_object(Bucket=bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise CommandError(
                f"Object storage check failed at {step} (bucket {bucket}, endpoint {endpoint}): "
                f"{exc}. {HINT}"
            ) from exc
        self.stdout.write(self.style.SUCCESS(f"ok  put/get/delete {key}"))
