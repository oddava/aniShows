"""A key built while its version lookup failed is never cached (council r1).

Redis can flap: the version (or namespace) read fails, then the payload write
right after it succeeds. With a fixed outage version that write landed under a
key every later outage request shared, and it outlived the invalidations made
under the real version: a profile made private in between came back public.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.forums import cache_utils
from apps.shared import public_cache
from apps.users.services import cache as user_cache
from apps.users.services.public_profile_service import PublicProfileError, get_public_profile

User = get_user_model()


class _VersionReadsFail:
    """The real cache, except that reads of keys with ``prefix`` raise (a flap)."""

    def __init__(self, prefix: str):
        self._prefix = prefix

    def get(self, key, *args, **kwargs):
        if key.startswith(self._prefix):
            raise RedisConnectionError("flap")
        return cache.get(key, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(cache, name)


def _stored_keys() -> list[str]:
    return list(cache._cache)  # type: ignore[attr-defined]  # LocMemCache internals


class OutageVersionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_outage_versions_are_unique_and_marked(self):
        first, second = public_cache.cache_outage_version(), public_cache.cache_outage_version()
        self.assertNotEqual(first, second)
        self.assertTrue(public_cache.is_cache_outage_key(f"k:v{first}:x"))
        self.assertFalse(public_cache.is_cache_outage_key("k:v3:x"))

    def test_payload_under_an_outage_key_is_built_and_never_stored(self):
        key = f"anime_list:ns:{public_cache.cache_outage_version()}"
        calls = []

        def build():
            calls.append(1)
            return {"results": [len(calls)]}

        self.assertEqual(public_cache.get_or_build_public_payload(key, build, ttl=300)[1], "bypass")
        self.assertEqual(public_cache.get_or_build_public_payload(key, build, ttl=300)[1], "bypass")
        self.assertEqual(len(calls), 2)
        self.assertFalse(public_cache.best_effort_set(key, {"x": 1}, 300, source="test"))
        cache.set(key, {"x": 1}, 300)  # even a raw write is never read back
        self.assertIsNone(public_cache.best_effort_get(key, source="test"))
        self.assertEqual(_stored_keys(), [f":1:{key}"])

    def test_forum_version_flap_never_shares_a_key(self):
        flaky = _VersionReadsFail(cache_utils.THREAD_LIST_VERSION_KEY)
        with mock.patch.object(cache_utils, "cache", flaky):
            first = cache_utils.get_thread_list_cache_key()
            second = cache_utils.get_thread_list_cache_key()
        self.assertNotEqual(first, second)
        self.assertTrue(public_cache.is_cache_outage_key(first))

    def test_a_profile_made_private_between_two_flaps_stays_private(self):
        owner = User.objects.create_user("owner", "owner@example.com", "pw-123456")
        flaky = _VersionReadsFail("profile_cache_version:")
        with mock.patch.object(user_cache, "cache", flaky):
            # Flap 1: the version read fails, the payload write would succeed.
            self.assertFalse(get_public_profile("owner").data["is_private"])
            self.assertFalse(any("cache-outage-" in key for key in _stored_keys()))

            owner.userprofile.is_private = True
            owner.userprofile.save(update_fields=["is_private"])

            # Flap 2: no public copy to revive.
            with self.assertRaises(PublicProfileError):
                get_public_profile("owner")
