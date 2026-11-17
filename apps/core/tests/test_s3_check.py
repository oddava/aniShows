"""manage.py s3_check: the deploy's object-storage preflight."""

from io import StringIO
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError, EndpointConnectionError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

S3 = {
    "USE_S3": True,
    "AWS_STORAGE_BUCKET_NAME": "anishows-media",
    "AWS_S3_ENDPOINT_URL": "http://rustfs:9000",
    "AWS_ACCESS_KEY_ID": "anishows",
    "AWS_SECRET_ACCESS_KEY": "secret",
    "AWS_S3_REGION_NAME": "us-east-1",
    "AWS_S3_ADDRESSING_STYLE": "path",
    "PUBLIC_MEDIA_LOCATION": "media",
}


def _client(**errors):
    """A client that stores what is put and fails the named calls."""
    store: dict[str, bytes] = {}
    client = MagicMock()

    def put_object(**kwargs):
        if "put_object" in errors:
            raise errors["put_object"]
        store[kwargs["Key"]] = kwargs["Body"]

    def get_object(**kwargs):
        body = MagicMock()
        body.read.return_value = store[kwargs["Key"]]
        return {"Body": body}

    client.head_bucket.side_effect = errors.get("head_bucket")
    client.put_object.side_effect = put_object
    client.get_object.side_effect = get_object
    client.delete_object.side_effect = lambda **kwargs: store.pop(kwargs["Key"])
    client.store = store
    return client


def _denied(operation):
    return ClientError({"Error": {"Code": "AccessDenied", "Message": "denied"}}, operation)


@override_settings(**S3)
class S3CheckTests(SimpleTestCase):
    def _run(self, client):
        out = StringIO()
        with patch("apps.core.management.commands.s3_check._client", return_value=client):
            call_command("s3_check", stdout=out)
        return out.getvalue()

    def test_a_working_bucket_passes_and_leaves_nothing_behind(self):
        client = _client()
        out = self._run(client)
        client.head_bucket.assert_called_once_with(Bucket="anishows-media")
        (key,) = [call.kwargs["Key"] for call in client.put_object.call_args_list]
        self.assertRegex(key, r"^media/\.deploy-probe-\d+$")
        client.delete_object.assert_called_once_with(Bucket="anishows-media", Key=key)
        self.assertEqual(client.store, {})
        self.assertIn("put/get/delete", out)

    def test_an_unreachable_endpoint_names_the_network_and_the_values(self):
        client = _client(head_bucket=EndpointConnectionError(endpoint_url="http://rustfs:9000"))
        with self.assertRaises(CommandError) as ctx:
            self._run(client)
        message = str(ctx.exception)
        self.assertIn("head_bucket", message)
        self.assertIn("anishows-s3 network attached to rustfs", message)
        self.assertIn("AWS_", message)
        client.put_object.assert_not_called()

    def test_a_user_that_cannot_write_fails_at_the_write(self):
        client = _client(put_object=_denied("PutObject"))
        with self.assertRaises(CommandError) as ctx:
            self._run(client)
        self.assertIn("put_object", str(ctx.exception))
        client.delete_object.assert_not_called()

    def test_different_bytes_back_fail(self):
        client = _client()
        client.get_object.side_effect = lambda **kwargs: {
            "Body": MagicMock(read=MagicMock(return_value=b"other"))
        }
        with self.assertRaises(CommandError) as ctx:
            self._run(client)
        self.assertIn("different bytes", str(ctx.exception))

    @override_settings(USE_S3=False)
    def test_local_storage_is_not_a_pass(self):
        with self.assertRaises(CommandError):
            self._run(_client())

    @override_settings(AWS_STORAGE_BUCKET_NAME="")
    def test_an_empty_bucket_name_fails_before_any_call(self):
        client = _client()
        with self.assertRaises(CommandError):
            self._run(client)
        client.head_bucket.assert_not_called()
