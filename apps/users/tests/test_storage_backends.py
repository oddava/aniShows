from unittest.mock import MagicMock, PropertyMock, patch

from botocore.exceptions import ClientError
from django.test import SimpleTestCase, override_settings

from root.storage_backends import MediaStorage


class MediaStorageTests(SimpleTestCase):
    @override_settings(S3_RUNTIME_BUCKET_AUTOCREATE=False)
    @patch("root.storage_backends.S3Boto3Storage.save", return_value="media/avatars/test.webp")
    def test_save_skips_bucket_probe_by_default(self, mock_super_save):
        storage = MediaStorage()

        with patch.object(storage, "_ensure_bucket_exists") as mock_ensure:
            result = storage.save("avatars/test.webp", MagicMock())

        self.assertEqual(result, "media/avatars/test.webp")
        mock_ensure.assert_not_called()
        mock_super_save.assert_called_once()

    @override_settings(S3_RUNTIME_BUCKET_AUTOCREATE=True)
    @patch("root.storage_backends.S3Boto3Storage.save", return_value="media/avatars/test.webp")
    def test_save_can_opt_in_to_bucket_probe(self, mock_super_save):
        storage = MediaStorage()

        with patch.object(storage, "_ensure_bucket_exists") as mock_ensure:
            result = storage.save("avatars/test.webp", MagicMock())

        self.assertEqual(result, "media/avatars/test.webp")
        mock_ensure.assert_called_once()
        mock_super_save.assert_called_once()

    @override_settings(S3_RUNTIME_BUCKET_AUTOCREATE=True)
    def test_bucket_probe_is_attempted_once_per_process(self):
        storage = MediaStorage()
        previous_checked = MediaStorage._bucket_checked
        self.addCleanup(setattr, MediaStorage, "_bucket_checked", previous_checked)
        MediaStorage._bucket_checked = False

        client = MagicMock()
        connection = MagicMock()
        connection.meta.client = client

        with patch.object(
            MediaStorage, "connection", new_callable=PropertyMock
        ) as mock_connection:
            mock_connection.return_value = connection

            storage._ensure_bucket_exists()
            storage._ensure_bucket_exists()

        client.head_bucket.assert_called_once_with(Bucket=storage.bucket_name)
        client.create_bucket.assert_not_called()

    @override_settings(S3_RUNTIME_BUCKET_AUTOCREATE=True)
    def test_bucket_probe_does_not_attempt_create_for_permission_error(self):
        storage = MediaStorage()
        previous_checked = MediaStorage._bucket_checked
        self.addCleanup(setattr, MediaStorage, "_bucket_checked", previous_checked)
        MediaStorage._bucket_checked = False

        client = MagicMock()
        client.head_bucket.side_effect = ClientError(
            {
                "Error": {"Code": "403", "Message": "Forbidden"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "HeadBucket",
        )
        connection = MagicMock()
        connection.meta.client = client

        with patch.object(
            MediaStorage, "connection", new_callable=PropertyMock
        ) as mock_connection, patch("root.storage_backends.logger.warning") as mock_warning:
            mock_connection.return_value = connection

            storage._ensure_bucket_exists()

        client.create_bucket.assert_not_called()
        mock_warning.assert_called()
