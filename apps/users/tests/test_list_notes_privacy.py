"""List notes are owner-only (ANISHOWS-004).

A public list is readable by anyone, but the personal notes on each entry, and
the notes copied onto activity rows, are returned to their owner only.
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from ...animes.models import Anime
from ..models import UserActivity, UserAnimeList, UserProfile

User = get_user_model()

NOTE = "Rewatch the finale with subtitles"


class ListNotesPrivacyTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="noteowner", email="n@example.com", password="x")
        UserProfile.objects.filter(user=self.owner).update(email_verified=True)
        self.other = User.objects.create_user(username="noteother", email="o@example.com", password="x")
        self.anime = Anime.objects.create(title="Noted", slug="noted", episode_count=12)
        self.entry = UserAnimeList.objects.create(
            user=self.owner, anime=self.anime, status="Watching", notes=NOTE
        )
        UserActivity.objects.create(
            user=self.owner,
            anime=self.anime,
            activity_type=UserActivity.ActivityType.NOTES_UPDATE,
            notes=NOTE,
        )

    def _list(self):
        response = self.client.get("/api/v1/lists/", {"username": self.owner.username})
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def _activity(self):
        response = self.client.get("/api/v1/activity/", {"username": self.owner.username})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        return body["results"] if isinstance(body, dict) else body

    def test_anonymous_reader_gets_the_list_without_notes(self):
        rows = self._list()
        self.assertEqual([row["id"] for row in rows], [self.entry.id])
        self.assertNotIn("notes", rows[0])
        self.assertEqual(rows[0]["status"], "Watching")

    def test_another_signed_in_user_gets_the_list_without_notes(self):
        self.client.force_authenticate(user=self.other)
        rows = self._list()
        self.assertNotIn("notes", rows[0])

    def test_owner_still_sees_their_notes(self):
        self.client.force_authenticate(user=self.owner)
        rows = self._list()
        self.assertEqual(rows[0]["notes"], NOTE)

    def test_activity_notes_are_owner_only(self):
        rows = self._activity()
        self.assertTrue(rows)
        self.assertTrue(all("notes" not in row for row in rows))

        self.client.force_authenticate(user=self.owner)
        rows = self._activity()
        self.assertEqual(rows[0]["notes"], NOTE)
