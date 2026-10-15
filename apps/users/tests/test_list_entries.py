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


class FriendsWatchingPrivacyTests(APITestCase):
    def test_private_mutual_is_not_listed(self):
        from ..models import UserFollow, UserProfile

        me = User.objects.create_user(username="me1", email="me@example.com", password="x")
        friend = User.objects.create_user(username="friend", email="f@example.com", password="x")
        UserFollow.objects.create(follower=me, following=friend)
        UserFollow.objects.create(follower=friend, following=me)
        anime = Anime.objects.create(title="Shared", slug="shared", episode_count=12)
        UserAnimeList.objects.create(user=friend, anime=anime, status="Watching")
        self.client.force_authenticate(user=me)
        url = "/api/v1/follows/friends/watching/"

        self.assertEqual(len(self.client.get(url, {"anime_id": anime.id}).data), 1)

        UserProfile.objects.filter(user=friend).update(is_private=True)
        self.assertEqual(len(self.client.get(url, {"anime_id": anime.id}).data), 0)


class DottedUsernameRouteTests(APITestCase):
    def test_follow_routes_accept_dots_in_usernames(self):
        """The username validator allows '.', so the routes must too."""
        User.objects.create_user(username="john.doe", email="j@example.com", password="x")
        viewer = User.objects.create_user(username="viewer", email="v@example.com", password="x")
        self.client.force_authenticate(user=viewer)

        for route in ("followers", "following", "mutuals", "check"):
            with self.subTest(route=route):
                response = self.client.get(f"/api/v1/follows/{route}/john.doe/")
                self.assertEqual(response.status_code, 200)
