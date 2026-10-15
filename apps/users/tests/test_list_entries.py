from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from ...animes.models import Anime
from ..models import UserAnimeList

User = get_user_model()


class ListEntryIntegrityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="lister", email="l@example.com", password="x")
        self.client.force_authenticate(user=self.user)
        self.first = Anime.objects.create(title="First", slug="first", episode_count=12)
        self.second = Anime.objects.create(title="Second", slug="second", episode_count=12)

    def test_create_without_status_defaults_to_plan_to_watch(self):
        response = self.client.post("/api/v1/lists/", {"anime_id": self.first.id}, format="json")

        self.assertEqual(response.status_code, 201)
        entry = UserAnimeList.objects.get(user=self.user, anime=self.first)
        self.assertEqual(entry.status, UserAnimeList.UserAnimeStatus.plan_to_watch)

    def test_update_cannot_repoint_entry_to_another_anime(self):
        entry = UserAnimeList.objects.create(user=self.user, anime=self.first, status="Watching")
        UserAnimeList.objects.create(user=self.user, anime=self.second, status="Watching")

        response = self.client.patch(
            f"/api/v1/lists/{entry.id}/", {"anime_id": self.second.id, "score": 7}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual((entry.anime_id, entry.score), (self.first.id, 7))

    def test_cannot_edit_someone_elses_entry(self):
        other = User.objects.create_user(username="other", email="o@example.com", password="x")
        entry = UserAnimeList.objects.create(user=other, anime=self.first, status="Watching")

        response = self.client.patch(f"/api/v1/lists/{entry.id}/", {"score": 1}, format="json")

        self.assertIn(response.status_code, (403, 404))
        entry.refresh_from_db()
        self.assertEqual(entry.score, 0)
