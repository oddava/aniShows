"""Read endpoints answer with the cache (Redis) down instead of a 500.

Found by stopping Redis in the production stack and requesting every GET
route (docs/deploy/DEPLOY.md, "Verified locally"): these built their payload
around a bare cache.get/cache.set. Credential endpoints are covered by
apps/users/tests/test_auth_cache_outage.py (they fail closed with a 503).
"""

from contextlib import ExitStack
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from redis.exceptions import ConnectionError as RedisConnectionError
from rest_framework.test import APITestCase

from apps.animes.models import Anime
from apps.forums.models import Category, Thread
from apps.shared import throttling

User = get_user_model()
CACHE_METHODS = ("get", "get_many", "set", "set_many", "add", "delete", "delete_many", "incr")


class ReadEndpointsSurviveACacheOutageTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username="outagereader", email="outagereader@example.com", password="securepass123"
        )
        cls.staff = User.objects.create_user(
            username="outagestaff",
            email="outagestaff@example.com",
            password="securepass123",
            is_staff=True,
            is_superuser=True,
        )
        cls.anime = Anime.objects.create(title="Outage Show", slug="outage-show", anilist_id=990001)
        cls.category = Category.objects.create(name="General", slug="general", description="x")
        cls.thread = Thread.objects.create(
            category=cls.category, title="Outage thread", author=cls.user, content="hello"
        )

    def setUp(self):
        throttling._last_outage_log.clear()

    def _cache_down(self) -> ExitStack:
        stack = ExitStack()
        down = RedisConnectionError("cache down")
        for method in CACHE_METHODS:
            stack.enter_context(patch.object(cache, method, side_effect=down))
        # No network: AniList answers nothing (the pages fall back as they do
        # when it is busy).
        from apps.animes.services.anilist import AniListService

        stack.enter_context(
            patch.object(AniListService, "get_recommendations_for_anime", return_value=[])
        )
        stack.enter_context(patch.object(AniListService, "get_episode_schedule", return_value=None))
        return stack

    def _assert_no_500(self, urls, *, user=None):
        if user is not None:
            self.client.force_authenticate(user)
        for url in urls:
            with self.subTest(url=url, user=getattr(user, "username", "anonymous")):
                with self._cache_down():
                    response = self.client.get(url)
                self.assertLess(response.status_code, 500, response.content[:300])

    def test_public_pages(self):
        self._assert_no_500(
            [
                "/api/v1/anime/outage-show/",
                "/api/v1/anime/outage-show/recommendations/",
                "/api/v1/anime/outage-show/watch-episodes/",
                "/api/v1/forums/categories/",
                "/api/v1/forums/categories/general/",
                "/api/v1/forums/tags/",
                "/api/v1/forums/threads/",
                f"/api/v1/forums/threads/{self.thread.pk}/",
                "/api/v1/users/outagereader/",
            ]
        )

    def test_signed_in_pages(self):
        self._assert_no_500(
            [
                "/api/v1/users/me/",
                "/api/v1/users/me/stats/",
                "/api/v1/activity/heatmap/",
                "/api/v1/users/outagereader/",
            ],
            user=self.user,
        )

    def test_admin_report(self):
        self._assert_no_500(["/api/v1/admin/reports/"], user=self.staff)
