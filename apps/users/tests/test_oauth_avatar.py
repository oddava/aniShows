from unittest.mock import patch

from django.test import SimpleTestCase

from ..adapters import _download_google_avatar


class FakeAvatarResponse:
    def __init__(self, *, status_code=200, headers=None, chunks=None):
        self.status_code = status_code
        self.headers = headers or {"content-type": "image/jpeg"}
        self.chunks = chunks or [b"avatar"]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def iter_bytes(self):
        yield from self.chunks


class OAuthAvatarDownloadTests(SimpleTestCase):
    @patch("apps.users.adapters.httpx.stream")
    def test_rejects_non_https_avatar_url(self, mock_stream):
        self.assertIsNone(_download_google_avatar("http://lh3.googleusercontent.com/a/avatar"))
        mock_stream.assert_not_called()

    @patch("apps.users.adapters.httpx.stream")
    def test_rejects_untrusted_avatar_host(self, mock_stream):
        self.assertIsNone(_download_google_avatar("https://googleusercontent.com.evil.test/a/avatar"))
        mock_stream.assert_not_called()

    @patch("apps.users.adapters.httpx.stream")
    def test_rejects_non_image_content_type(self, mock_stream):
        mock_stream.return_value = FakeAvatarResponse(headers={"content-type": "text/html"})

        self.assertIsNone(_download_google_avatar("https://lh3.googleusercontent.com/a/avatar"))

    @patch("apps.users.adapters.httpx.stream")
    def test_rejects_oversized_content_length(self, mock_stream):
        mock_stream.return_value = FakeAvatarResponse(
            headers={
                "content-type": "image/jpeg",
                "content-length": str(2 * 1024 * 1024 + 1),
            },
        )

        self.assertIsNone(_download_google_avatar("https://lh3.googleusercontent.com/a/avatar"))

    @patch("apps.users.adapters.httpx.stream")
    def test_rejects_oversized_streamed_body(self, mock_stream):
        mock_stream.return_value = FakeAvatarResponse(
            headers={"content-type": "image/jpeg"},
            chunks=[b"x" * (2 * 1024 * 1024 + 1)],
        )

        self.assertIsNone(_download_google_avatar("https://lh3.googleusercontent.com/a/avatar"))

    @patch("apps.users.adapters.httpx.stream")
    def test_accepts_trusted_google_image(self, mock_stream):
        mock_stream.return_value = FakeAvatarResponse(chunks=[b"safe", b"avatar"])

        self.assertEqual(
            _download_google_avatar("https://lh3.googleusercontent.com/a/avatar"),
            b"safeavatar",
        )
