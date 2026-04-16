from io import BytesIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from rest_framework.exceptions import ValidationError

from ..serializers.base import validate_image_content
from ..views.image_views import ImageResizeView


class ImageValidationDependencyTests(SimpleTestCase):
    @patch("magic.from_buffer", return_value="image/jpeg")
    @patch("apps.animes.serializers.base.get_pillow_image_module", return_value=None)
    def test_validate_image_content_fails_closed_when_pillow_is_unavailable(
        self,
        _mock_get_pillow_image_module,
        _mock_magic_from_buffer,
    ):
        upload = SimpleUploadedFile("avatar.jpg", b"fake-jpeg-bytes", content_type="image/jpeg")

        with self.assertRaises(ValidationError) as ctx:
            validate_image_content(upload, 1024 * 1024, "Avatar")

        self.assertIn("temporarily unavailable", str(ctx.exception))


class ImageResizeDependencyTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("apps.animes.views.image_views.get_pillow_image_module", return_value=None)
    @patch.object(ImageResizeView, "_serve_original", return_value=HttpResponse(b"original"))
    @patch("apps.animes.views.image_views.default_storage.exists", return_value=True)
    def test_resize_view_serves_original_when_pillow_is_unavailable(
        self,
        _mock_exists,
        mock_serve_original,
        _mock_get_pillow_image_module,
    ):
        request = self.factory.get("/media/resize/poster.jpg", {"w": 200})

        response = ImageResizeView.as_view()(request, filepath="poster.jpg")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"original")
        mock_serve_original.assert_called_once_with("poster.jpg")
