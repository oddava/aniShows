"""Concurrent list writes (spec 3 P0-8): the POST upsert is idempotent under a race."""

import contextlib
import threading
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from ...animes.models import Anime
from ...animes.tasks.recommendations import generate_recommendations
from ..models import UserAnimeList, UserProfile
from ..tasks import update_user_stats

User = get_user_model()


class ConcurrentUpsertTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="racer", email="r@example.com", password="x")
        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        self.anime = Anime.objects.create(title="Race", slug="race", episode_count=12)
        for task in (update_user_stats, generate_recommendations):
            stub = patch.object(task, "apply_async")
            stub.start()
            self.addCleanup(stub.stop)

    def _post_concurrently(self, payloads):
        """Both requests reach the "does the entry exist" check together, before either inserts."""
        barrier = threading.Barrier(len(payloads))
        seen = threading.local()
        real_select_for_update = UserAnimeList.objects.select_for_update

        def synced_select_for_update(*args, **kwargs):
            if not getattr(seen, "done", False):
                seen.done = True
                with contextlib.suppress(threading.BrokenBarrierError):
                    barrier.wait(timeout=10)
            return real_select_for_update(*args, **kwargs)

        statuses: list[int] = []

        def post(payload):
            try:
                client = APIClient()
                client.force_authenticate(user=self.user)
                statuses.append(client.post("/api/v1/lists/", payload, format="json").status_code)
            finally:
                connection.close()

        with patch.object(
            UserAnimeList.objects, "select_for_update", side_effect=synced_select_for_update
        ):
            threads = [threading.Thread(target=post, args=(payload,)) for payload in payloads]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
        return statuses

    def test_two_concurrent_posts_for_a_new_entry_leave_one_row_and_both_succeed(self):
        statuses = self._post_concurrently(
            [
                {"anime_id": self.anime.id, "status": "Watching"},
                {"anime_id": self.anime.id, "status": "Watching", "score": 7},
            ]
        )

        self.assertEqual(sorted(statuses), [200, 201], statuses)
        self.assertEqual(UserAnimeList.objects.filter(user=self.user, anime=self.anime).count(), 1)
