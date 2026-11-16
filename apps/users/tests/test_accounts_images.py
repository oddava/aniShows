"""Uploaded and OAuth profile images are re-encoded without metadata (A12, P1-5)."""

import io
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from root.storage_backends import MediaStorage

from ..adapters import MySocialAccountAdapter
from ..models import UserProfile
from ..utils import image_processing
from ..utils.image_processing import ProfileImageError, normalize_profile_image

User = get_user_model()

ORIENTATION = 0x0112
MAKE = 0x010F
GPS_IFD = 0x8825


def jpeg_with_exif(size=(1200, 800), orientation=None) -> bytes:
    image = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[MAKE] = "SpyCam"
    exif.get_ifd(GPS_IFD)[2] = (51.0, 30.0, 0.0)  # GPSLatitude
    if orientation:
        exif[ORIENTATION] = orientation
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def animated_gif(frames: int) -> bytes:
    # Distinct colours: Pillow merges identical consecutive frames.
    images = [
        Image.new("RGB", (20, 20), (index * 2 % 256, index, 255 - index)) for index in range(frames)
    ]
    buffer = io.BytesIO()
    images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:], duration=50)
    return buffer.getvalue()


def opened(file) -> Image.Image:
    file.seek(0)
    return Image.open(io.BytesIO(file.read()))


class NormalizeProfileImageTests(SimpleTestCase):
    def _normalize(self, data: bytes, kind="avatar", max_size=5 * 1024 * 1024):
        return normalize_profile_image(
            ContentFile(data, name="upload.jpg"), kind, max_size=max_size
        )

    def test_avatar_becomes_webp_without_exif_and_at_most_512px(self):
        result = self._normalize(jpeg_with_exif((1200, 800)))

        self.assertTrue(result.name.endswith(".webp"))
        image = opened(result)
        self.assertEqual(image.format, "WEBP")
        self.assertLessEqual(max(image.size), 512)
        self.assertEqual(dict(image.getexif()), {})
        self.assertNotIn("exif", image.info)

    def test_banner_is_capped_at_2560_wide(self):
        image = opened(self._normalize(jpeg_with_exif((4000, 1000)), kind="banner"))
        self.assertEqual(image.size, (2560, 640))

    def test_small_images_are_not_upscaled(self):
        self.assertEqual(opened(self._normalize(jpeg_with_exif((300, 200)))).size, (300, 200))

    def test_exif_orientation_is_applied_before_stripping(self):
        image = opened(self._normalize(jpeg_with_exif((400, 200), orientation=6)))
        self.assertEqual(image.size, (200, 400))  # rotated upright

    def test_transparency_survives(self):
        buffer = io.BytesIO()
        Image.new("RGBA", (64, 64), (0, 0, 0, 0)).save(buffer, format="PNG")
        self.assertEqual(opened(self._normalize(buffer.getvalue())).mode, "RGBA")

    def test_small_animated_gif_is_kept_as_is(self):
        data = animated_gif(3)
        result = self._normalize(data)
        result.seek(0)
        self.assertEqual(result.read(), data)

    def test_long_animated_gif_is_rejected(self):
        with self.assertRaisesMessage(ProfileImageError, "at most 120 frames"):
            self._normalize(animated_gif(121))

    def test_non_images_and_oversized_files_are_rejected(self):
        with self.assertRaises(ProfileImageError):
            self._normalize(b"<?php echo 'hi'; ?>" * 50)
        with self.assertRaisesMessage(ProfileImageError, "too large"):
            self._normalize(jpeg_with_exif(), max_size=100)

    def test_pixel_count_is_capped(self):
        with (
            patch.object(image_processing, "MAX_SOURCE_PIXELS", 1000),
            self.assertRaisesMessage(ProfileImageError, "pixels"),
        ):
            self._normalize(jpeg_with_exif((100, 100)))


@patch.object(MediaStorage, "save", autospec=True, side_effect=lambda storage, name, *a, **k: name)
class UploadEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="snapper", email="snapper@example.com", password="securepass123"
        )
        self.client.force_authenticate(self.user)

    def test_uploaded_gps_jpeg_is_stored_as_webp(self, _save):
        upload = SimpleUploadedFile("holiday.jpg", jpeg_with_exif(), content_type="image/jpeg")

        response = self.client.patch(
            reverse("user_profile"), {"avatar": upload}, format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        saved_content = _save.call_args.args[2]
        self.assertTrue(UserProfile.objects.get(user=self.user).avatar.name.endswith(".webp"))
        image = opened(saved_content)
        self.assertEqual(image.format, "WEBP")
        self.assertEqual(dict(image.getexif()), {})

    def test_bad_upload_is_a_400_with_a_message(self, _save):
        upload = SimpleUploadedFile("x.jpg", b"not an image" * 100, content_type="image/jpeg")
        response = self.client.patch(
            reverse("user_profile"), {"banner": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("banner", response.data["errors"])


@patch.object(MediaStorage, "save", autospec=True, side_effect=lambda storage, name, *a, **k: name)
class OAuthAvatarNormalisationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="oauthed", email="o@example.com")

    def _save_user(self, avatar_bytes):
        sociallogin = type(
            "SocialLogin",
            (),
            {
                "account": type(
                    "Account", (), {"extra_data": {"picture": "https://x.googleusercontent.com/a"}}
                )()
            },
        )()
        with (
            patch(
                "allauth.socialaccount.adapter.DefaultSocialAccountAdapter.save_user",
                return_value=self.user,
            ),
            patch("apps.users.adapters._download_google_avatar", return_value=avatar_bytes),
        ):
            MySocialAccountAdapter().save_user(None, sociallogin)
        return UserProfile.objects.get(user=self.user)

    def test_google_avatar_is_normalised(self, _save):
        profile = self._save_user(jpeg_with_exif((900, 900)))
        self.assertTrue(profile.avatar.name.endswith(".webp"))
        self.assertLessEqual(max(opened(_save.call_args.args[2]).size), 512)

    def test_unusable_google_avatar_is_skipped(self, _save):
        profile = self._save_user(b"garbage" * 100)
        self.assertFalse(profile.avatar)
        _save.assert_not_called()

    def test_download_timeout_is_short(self, _save):
        self.assertLessEqual(image_processing_timeout(), 3.0)


def image_processing_timeout() -> float:
    from .. import adapters

    return adapters.OAUTH_AVATAR_TIMEOUT_SECONDS
