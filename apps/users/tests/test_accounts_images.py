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
from ..utils.image_processing import ProfileImageError, clean_crop, normalize_profile_image

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


def animated_gif(frames: int, size=(20, 20)) -> bytes:
    # Distinct colours: Pillow merges identical consecutive frames.
    images = [
        # Far apart, so a lossy encoder never merges two frames into one.
        Image.new("RGB", size, (index * 67 % 256, index * 131 % 256, index * 29 % 256))
        for index in range(frames)
    ]
    buffer = io.BytesIO()
    images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:], duration=50)
    return buffer.getvalue()


def total_duration(image: Image.Image) -> int:
    total = 0
    for index in range(image.n_frames):
        image.seek(index)
        image.load()  # WebP fills in a frame's timing when it is loaded
        total += image.info.get("duration", 0)
    return total


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

    def test_animated_gif_stays_animated_as_webp(self):
        image = opened(self._normalize(animated_gif(3)))
        self.assertEqual(image.format, "WEBP")
        self.assertTrue(image.is_animated)
        self.assertEqual((image.n_frames, image.size), (3, (20, 20)))

    def test_a_long_animation_keeps_120_frames_and_its_timing(self):
        image = opened(self._normalize(animated_gif(250)))
        self.assertLessEqual(image.n_frames, 120)
        self.assertEqual(total_duration(image), 250 * 50)

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

    def test_big_animated_avatar_is_cropped_and_kept_animated(self, _save):
        upload = SimpleUploadedFile(
            "clip.gif", animated_gif(3, size=(540, 554)), content_type="image/gif"
        )
        response = self.client.patch(
            reverse("user_profile"),
            {"avatar": upload, "avatar_crop": '{"x": 0, "y": 10, "width": 540, "height": 540}'},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        image = opened(_save.call_args.args[2])
        self.assertTrue(image.is_animated)
        self.assertEqual(image.size, (512, 512))

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


class ImageEdgeCaseTests(SimpleTestCase):
    def test_tall_banner_is_capped_so_webp_can_encode_it(self):
        buffer = io.BytesIO()
        Image.new("RGB", (400, 20000), (1, 2, 3)).save(buffer, format="PNG")
        result = normalize_profile_image(
            ContentFile(buffer.getvalue(), name="tall.png"), "banner", max_size=5 * 1024 * 1024
        )
        width, height = opened(result).size
        self.assertLessEqual(height, 2560)
        self.assertEqual(width, round(400 * 2560 / 20000))

    def test_processing_failures_are_profile_image_errors(self):
        with (
            patch.object(image_processing, "_reencode", side_effect=OSError("encoder")),
            self.assertRaisesMessage(ProfileImageError, "could not be processed"),
        ):
            normalize_profile_image(
                ContentFile(jpeg_with_exif((50, 50)), name="x.jpg"), "avatar", max_size=10**6
            )

    def test_sixteen_bit_png_is_handled(self):
        buffer = io.BytesIO()
        Image.new("I;16", (64, 64)).save(buffer, format="PNG")
        result = normalize_profile_image(
            ContentFile(buffer.getvalue(), name="deep.png"), "avatar", max_size=10**6
        )
        self.assertEqual(opened(result).format, "WEBP")


class UploadAndRemoveTogetherTests(APITestCase):
    def test_avatar_upload_with_remove_avatar_is_400(self):
        user = User.objects.create_user(username="both", email="both@example.com", password="x")
        self.client.force_authenticate(user)
        upload = SimpleUploadedFile("a.jpg", jpeg_with_exif((50, 50)), content_type="image/jpeg")
        response = self.client.patch(
            reverse("user_profile"), {"avatar": upload, "remove_avatar": "true"}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("remove_avatar", response.data["errors"])


class AnimatedFitTests(SimpleTestCase):
    """Animations are fitted, not refused: resized, cropped and compressed."""

    def _normalize(self, data, kind="avatar", **kwargs):
        return normalize_profile_image(
            ContentFile(data, name="clip.gif"), kind, max_size=10 * 1024 * 1024, **kwargs
        )

    def test_an_oversized_animated_avatar_is_shrunk_to_512(self):
        image = opened(self._normalize(animated_gif(3, size=(540, 554))))
        self.assertTrue(image.is_animated)
        self.assertEqual(image.size, (499, 512))

    def test_the_crop_is_applied_to_every_frame(self):
        crop = (20, 30, 300, 300)
        image = opened(self._normalize(animated_gif(4, size=(540, 554)), crop=crop))
        self.assertEqual((image.size, image.n_frames), ((300, 300), 4))

    def test_a_display_sized_animated_banner_keeps_its_size(self):
        image = opened(self._normalize(animated_gif(3, size=(800, 200)), kind="banner"))
        self.assertEqual((image.format, image.size), ("WEBP", (800, 200)))

    def test_quality_steps_down_to_fit_the_stored_size(self):
        data = animated_gif(30, size=(400, 400))
        roomy = self._normalize(data, stored_max=10 * 1024 * 1024)
        roomy.seek(0)
        size = len(roomy.read())
        tight = self._normalize(data, stored_max=size - 1)
        tight.seek(0)
        self.assertLess(len(tight.read()), size)

    def test_an_animation_that_cannot_fit_is_refused_plainly(self):
        with self.assertRaisesMessage(ProfileImageError, "too heavy"):
            self._normalize(animated_gif(5, size=(200, 200)), stored_max=10)

    def test_a_huge_animation_is_refused_before_decoding(self):
        with (
            patch.object(image_processing, "MAX_ANIMATION_PIXELS", 1000),
            self.assertRaisesMessage(ProfileImageError, "too long or too large"),
        ):
            self._normalize(animated_gif(3, size=(40, 40)))

    def test_a_still_image_can_be_cropped_too(self):
        result = normalize_profile_image(
            ContentFile(jpeg_with_exif((1000, 800)), name="x.jpg"),
            "avatar",
            max_size=10**7,
            crop=(100, 100, 400, 400),
        )
        self.assertEqual(opened(result).size, (400, 400))


class CleanCropTests(SimpleTestCase):
    def test_reads_numbers_and_rejects_nonsense(self):
        self.assertIsNone(clean_crop(None))
        self.assertEqual(
            clean_crop({"x": "1.4", "y": 2, "width": 30.6, "height": 30}), (1, 2, 31, 30)
        )
        for bad in ("x", {"x": 1}, {"x": 1, "y": 1, "width": 0, "height": 5}):
            with self.assertRaises(ProfileImageError):
                clean_crop(bad)
