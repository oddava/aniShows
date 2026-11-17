from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ..cache_utils import flush_buffered_thread_views
from ..models import Category, Thread

User = get_user_model()


class ForumCacheBehaviorTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="forumuser",
            email="forum@example.com",
            password="password123",
        )
        self.category = Category.objects.create(
            name="General Discussion",
            slug="general-discussion",
            description="Talk about anything",
        )
        self.thread = Thread.objects.create(
            category=self.category,
            title="First Thread",
            author=self.user,
            content="Hello world",
        )

    def test_public_thread_list_sets_cache_header(self):
        url = reverse("forums:thread-list")

        first = self.client.get(url)
        second = self.client.get(url)

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first["X-Cache-Status"], "miss")
        self.assertEqual(second["X-Cache-Status"], "hit")

    def test_public_thread_detail_buffers_view_count_until_flush(self):
        url = reverse("forums:thread-detail", args=[self.thread.id])

        response = self.client.get(url)
        self.thread.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-Cache-Status"], "miss")
        self.assertEqual(self.thread.view_count, 0)

        result = flush_buffered_thread_views()
        self.thread.refresh_from_db()

        self.assertEqual(result["flushed"], 1)
        self.assertEqual(self.thread.view_count, 1)

    def test_public_list_and_detail_answer_with_the_cache_down(self):
        """A Redis outage serves the pages uncached and skips the view count."""
        from unittest.mock import patch

        from django.core.cache import cache
        from redis.exceptions import ConnectionError as RedisConnectionError

        down = RedisConnectionError("cache down")
        with (
            patch.object(cache, "get", side_effect=down),
            patch.object(cache, "get_many", side_effect=down),
            patch.object(cache, "set", side_effect=down),
            patch.object(cache, "add", side_effect=down),
            patch.object(cache, "delete", side_effect=down),
            patch.object(cache, "incr", side_effect=down),
            patch("apps.forums.views.buffer_thread_view_increment") as buffer_view,
        ):
            listed = self.client.get(reverse("forums:thread-list"))
            detail = self.client.get(reverse("forums:thread-detail", args=[self.thread.id]))

        self.assertEqual(listed.status_code, status.HTTP_200_OK, listed.content)
        self.assertEqual(listed["X-Cache-Status"], "bypass")
        self.assertEqual(detail.status_code, status.HTTP_200_OK, detail.content)
        buffer_view.assert_not_called()
