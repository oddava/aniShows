from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from ..tasks.watch_episodes import sync_watch_episodes_for_anime


class TaskDeduplicationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_duplicate_enqueue_is_skipped_but_a_retry_is_sent(self):
        with patch("celery.app.task.Task.apply_async") as send:
            sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": 7})
            sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": 7})
            sync_watch_episodes_for_anime.apply_async(
                kwargs={"anime_id": 7}, task_id="first", retries=1
            )

        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args.kwargs["retries"], 1)
