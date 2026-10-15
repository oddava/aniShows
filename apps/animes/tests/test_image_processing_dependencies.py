from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from ..serializers.base import validate_image_content


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
