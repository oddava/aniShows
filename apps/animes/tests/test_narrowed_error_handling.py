"""The ``except`` clauses narrowed in Phase 2 still catch what they used to.

Test settings disable existing loggers, so these tests mock the module logger.
"""

import io
from unittest import mock

from botocore.exceptions import ClientError, EndpointConnectionError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django_redis.exceptions import ConnectionInterrupted
from kombu.exceptions import OperationalError as KombuOperationalError
from PIL import Image
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework.exceptions import ValidationError

from ..serializers.base import validate_image_content
from ..services import user_list_side_effects
from ..services.rate_limiting import AniListRateLimiter, APICallCache, CircuitBreaker
from ..tasks import images


class CircuitBreakerCacheFailureTests(SimpleTestCase):
    def test_breaker_fails_open_when_redis_is_down(self):
        breaker = CircuitBreaker("narrow-test")
        with (
            mock.patch("apps.animes.services.rate_limiting.cache") as cache,
            mock.patch("apps.animes.services.rate_limiting.logger") as logger,
        ):
            cache.get.side_effect = ConnectionInterrupted(connection=None)
            cache.set.side_effect = ConnectionInterrupted(connection=None)

            self.assertFalse(breaker.is_open())
            breaker.record_success()
            breaker.record_failure()

        self.assertEqual(logger.exception.call_count, 3)

    def test_breaker_tolerates_a_corrupt_last_failure_value(self):
        breaker = CircuitBreaker("narrow-test-corrupt")
        values = {breaker._get_state_key(): "OPEN", breaker._get_last_failure_key(): "not-a-date"}
        with (
            mock.patch("apps.animes.services.rate_limiting.cache") as cache,
            mock.patch("apps.animes.services.rate_limiting.logger"),
        ):
            cache.get.side_effect = values.get
            self.assertFalse(breaker.is_open())

    def test_call_cache_is_best_effort(self):
        call_cache = APICallCache()
        with mock.patch("apps.animes.services.rate_limiting.cache") as cache:
            cache.get.side_effect = RedisConnectionError("down")
            cache.set.side_effect = RedisConnectionError("down")
            cache.delete.side_effect = RedisConnectionError("down")

            self.assertIsNone(call_cache.get("anime", "1"))
            call_cache.set("anime", "1", {"id": 1})
            self.assertFalse(call_cache.is_recently_updated(1))
            call_cache.mark_updated(1)
            call_cache.invalidate(1)

    def test_rate_limiter_falls_back_without_a_redis_cache(self):
        # LocMemCache has no raw Redis client (AttributeError).
        limiter = AniListRateLimiter()
        with mock.patch("apps.animes.services.rate_limiting.logger") as logger:
            limiter.acquire()
        logger.exception.assert_called_once()
        self.assertGreater(limiter._local_last_request, 0)


@override_settings(USE_S3=True)
class StorageProbeTests(SimpleTestCase):
    def test_endpoint_outage_is_reported_quietly(self):
        with (
            mock.patch("django.core.files.storage.default_storage") as storage,
            mock.patch("apps.animes.tasks.images.logger") as logger,
        ):
            storage.exists.side_effect = EndpointConnectionError(endpoint_url="http://minio:9000")
            self.assertFalse(images._is_storage_available())
        logger.warning.assert_not_called()

    def test_other_storage_errors_are_warned(self):
        error = ClientError({"Error": {"Code": "403", "Message": "Forbidden"}}, "HeadObject")
        with (
            mock.patch("django.core.files.storage.default_storage") as storage,
            mock.patch("apps.animes.tasks.images.logger") as logger,
        ):
            storage.exists.side_effect = error
            self.assertFalse(images._is_storage_available())
        logger.warning.assert_called_once()


class ImageMagicCheckTests(SimpleTestCase):
    def _png(self):
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="PNG")
        return SimpleUploadedFile("a.png", buffer.getvalue(), content_type="image/png")

    def test_accepts_an_allowed_image(self):
        upload = validate_image_content(self._png(), 1024 * 1024, "Avatar")
        self.assertEqual(upload.name, "a.png")
        self.assertEqual(upload.tell(), 0)

    def test_rejects_a_disallowed_mime_type(self):
        with (
            mock.patch("magic.from_buffer", return_value="text/plain"),
            self.assertRaisesMessage(ValidationError, "Invalid file content for Avatar"),
        ):
            validate_image_content(self._png(), 1024 * 1024, "Avatar")

    def test_rejects_an_image_format_outside_the_allow_list(self):
        # BMP is a valid image that Pillow verifies happily; the type check must stop it.
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="BMP")
        upload = SimpleUploadedFile("a.png", buffer.getvalue(), content_type="image/png")
        with self.assertRaisesMessage(ValidationError, "Allowed types"):
            validate_image_content(upload, 1024 * 1024, "Avatar")

    def test_libmagic_failure_is_logged(self):
        import magic

        with (
            mock.patch("magic.from_buffer", side_effect=magic.MagicException("libmagic broke")),
            mock.patch("apps.shared.logger.logger") as logger,
        ):
            validate_image_content(self._png(), 1024 * 1024, "Avatar")
        self.assertTrue(logger.warning.call_args.kwargs["exc_info"])


class StatsSideEffectFallbackTests(SimpleTestCase):
    def test_broker_outage_refreshes_stats_inline(self):
        user = mock.Mock(id=7, username="someone")
        with (
            mock.patch(
                "apps.users.tasks.schedule_user_stats_refresh",
                side_effect=KombuOperationalError("broker down"),
            ),
            mock.patch.object(user_list_side_effects, "invalidate_user_caches"),
            mock.patch.object(user_list_side_effects, "create_or_update_user_stats") as refresh,
            mock.patch.object(user_list_side_effects, "logger") as logger,
        ):
            user_list_side_effects.update_user_stats_and_cache(user)

        refresh.assert_called_once_with(user)
        logger.exception.assert_called_once()
