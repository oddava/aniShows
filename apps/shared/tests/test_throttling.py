"""Site-wide rate limits fail open when the cache (Redis) is down."""

from unittest import mock

from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.test import SimpleTestCase
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.shared.throttling import ResilientAnonRateThrottle, ResilientUserRateThrottle


class OnePerMinuteAnon(ResilientAnonRateThrottle):
    rate = "1/minute"


class OnePerMinuteUser(ResilientUserRateThrottle):
    rate = "1/minute"


class FailOpenThrottleTests(SimpleTestCase):
    def _request(self):
        request = APIRequestFactory().get("/api/v1/anime/", REMOTE_ADDR="198.51.100.7")
        request.user = AnonymousUser()
        return request

    def test_a_cache_outage_lets_the_request_through(self):
        for throttle_class in (OnePerMinuteAnon, OnePerMinuteUser):
            with (
                self.subTest(throttle=throttle_class.__name__),
                mock.patch.object(cache, "get", side_effect=RedisConnectionError("down")),
            ):
                throttle = throttle_class()
                self.assertTrue(throttle.allow_request(self._request(), APIView()))

    def test_limits_still_apply_with_the_cache_up(self):
        throttle = OnePerMinuteAnon()
        self.assertTrue(throttle.allow_request(self._request(), APIView()))
        self.assertFalse(throttle.allow_request(self._request(), APIView()))

    def test_they_are_the_default_classes(self):
        from django.conf import settings

        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"],
            [
                "apps.shared.throttling.ResilientAnonRateThrottle",
                "apps.shared.throttling.ResilientUserRateThrottle",
            ],
        )
