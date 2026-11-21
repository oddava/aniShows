"""P1 (UX review): every view of a profile shows the same list numbers.

The profile used to read the materialised ``UserStats`` row (refreshed later by
Celery) while the Stats tab read the live list summary, so right after a write
the Overview said "8.5 mean, 45 episodes" and Stats "7.7, 46". Both now come
from the one cached summary, which every list write drops.
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from ...animes.models import Anime
from ..models import UserAnimeList, UserProfile, UserStats

User = get_user_model()


class OneStatsCalculationTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="megumin", email="m@example.com", password="x"
        )
        frieren = Anime.objects.create(title="Frieren", slug="frieren", episode_count=28)
        piece = Anime.objects.create(title="One Piece", slug="one-piece", episode_count=0)
        dropped = Anime.objects.create(title="Dropped", slug="dropped", episode_count=12)
        UserAnimeList.objects.create(
            user=self.user, anime=frieren, status="Completed", episodes_watched=28, score=9
        )
        UserAnimeList.objects.create(
            user=self.user, anime=piece, status="Watching", episodes_watched=13, score=8
        )
        UserAnimeList.objects.create(
            user=self.user, anime=dropped, status="Dropped", episodes_watched=5, score=6
        )
        # A stale materialised row, as Celery would leave it before catching up.
        UserStats.objects.update_or_create(
            user=self.user,
            defaults={"anime_count": 2, "episodes_watched": 40, "mean_score": 8.5},
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})
        self.client.force_authenticate(self.user)

    def test_profile_public_profile_and_stats_tab_agree(self):
        summary = self.client.get(reverse("lists-summary")).data
        own = self.client.get(reverse("user_profile")).data
        public = self.client.get(f"/api/v1/users/{self.user.username}/").data

        expected = {"anime_count": 3, "episodes_watched": 46, "mean_score": 7.7}
        for payload in (own, public):
            self.assertEqual(
                {key: payload[key] for key in expected}, expected, msg=payload.get("username")
            )
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["episodes_watched"], 46)
        self.assertEqual(summary["mean_score"], 7.7)
        # The rule shown next to the number: "mean of 3 rated shows".
        self.assertEqual(summary["rated_count"], 3)
        self.assertEqual(own["rated_count"], 3)

    def test_a_write_shows_up_everywhere_at_once(self):
        self.client.get(reverse("user_profile"))  # warm the profile cache
        entry = UserAnimeList.objects.get(user=self.user, anime__slug="dropped")

        response = self.client.patch(
            reverse("lists-detail", args=[entry.id]), {"score": 3}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)

        own = self.client.get(reverse("user_profile")).data
        summary = self.client.get(reverse("lists-summary")).data
        self.assertEqual(own["mean_score"], summary["mean_score"])
        self.assertEqual(own["mean_score"], round((9 + 8 + 3) / 3, 1))
