"""Guards the QA re-audit (27 Nov) found good on live; they must stay that way.

- another user's list entry is a 404 for get, patch and delete (no IDOR);
- is_staff / is_superuser / points in a profile update are ignored;
- a private profile's list is not shown to others;
- the profile list filters by genre (profile improvement, same release).
"""

from typing import Any

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient, APITestCase

from ...animes.models import Anime, Genre
from ..models import UserAnimeList, UserProfile

User = get_user_model()
XHR: dict[str, Any] = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class ListEntryIdorTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", email="o@example.com", password="x")
        self.intruder = User.objects.create_user(
            username="intruder", email="i@example.com", password="x"
        )
        for user in (self.owner, self.intruder):
            UserProfile.objects.filter(user=user).update(email_verified=True)
        anime = Anime.objects.create(title="Frieren", slug="frieren", episode_count=28)
        self.entry = UserAnimeList.objects.create(
            user=self.owner, anime=anime, status="Watching", score=8, notes="private note"
        )
        self.client.force_authenticate(user=self.intruder)

    def test_another_users_entry_is_not_found(self):
        url = f"/api/v1/lists/{self.entry.id}/"

        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"score": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)

        self.entry.refresh_from_db()
        self.assertEqual((self.entry.score, self.entry.status), (8, "Watching"))


class ProfileMassAssignmentTests(APITestCase):
    def test_privileged_fields_are_ignored(self):
        user = User.objects.create_user(username="plain", email="p@example.com", password="x")
        self.client.force_authenticate(user=user)

        self.client.patch(
            "/api/v1/users/me/",
            {"is_staff": True, "is_superuser": True, "points": 999_999, "bio": "hi"},
            format="json",
        )

        user.refresh_from_db()
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(UserProfile.objects.get(user=user).points, 0)


class PrivateListTests(APITestCase):
    def test_a_private_profiles_list_is_hidden_from_others(self):
        owner = User.objects.create_user(username="hidden", email="h@example.com", password="x")
        UserProfile.objects.filter(user=owner).update(is_private=True)
        anime = Anime.objects.create(title="Secret", slug="secret", episode_count=1)
        UserAnimeList.objects.create(user=owner, anime=anime, status="Completed")

        response = APIClient().get("/api/v1/lists/", {"username": "hidden"})

        self.assertIn(response.status_code, (200, 404))
        if response.status_code == 200:
            self.assertEqual(response.json()["results"], [])


class ProfileListGenreFilterTests(APITestCase):
    def test_the_list_filters_by_genre(self):
        owner = User.objects.create_user(username="lister", email="l@example.com", password="x")
        drama = Genre.objects.create(name="Drama", slug="drama")
        comedy = Genre.objects.create(name="Comedy", slug="comedy")
        sad = Anime.objects.create(title="Sad", slug="sad", episode_count=1)
        sad.genres.add(drama)
        funny = Anime.objects.create(title="Funny", slug="funny", episode_count=1)
        funny.genres.add(comedy)
        both = Anime.objects.create(title="Both", slug="both", episode_count=1)
        both.genres.add(drama, comedy)
        for anime in (sad, funny, both):
            UserAnimeList.objects.create(user=owner, anime=anime, status="Completed")

        response = APIClient().get(
            "/api/v1/lists/", {"username": "lister", "genre": "drama", "ordering": "title"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row["anime"]["title"] for row in response.json()["results"]], ["Both", "Sad"]
        )
        self.assertEqual(response.json()["count"], 2)
