"""Review stats are cached per anime and dropped when a review changes (spec 5 P1-7)."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ...users.models import UserAnimeList, UserProfile
from ..models import Anime, Review

User = get_user_model()


class ReviewStatsCacheTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="stats-user", email="stats-user@example.com", password="password123"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})
        self.anime = Anime.objects.create(
            title="Stats Anime", slug="stats-anime", anime_type="TV", status="Airing"
        )
        UserAnimeList.objects.create(user=self.user, anime=self.anime, status="Completed")
        self.client.force_authenticate(user=self.user)

    def _stats(self):
        response = self.client.get(reverse("reviews-stats"), {"anime": self.anime.slug})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_stats_are_served_from_cache(self):
        self.assertEqual(self._stats()["total_reviews"], 0)

        # A write that skips the signals leaves the cached payload in place.
        Review.objects.bulk_create([Review(user=self.user, anime=self.anime, rating=8)])

        self.assertEqual(self._stats()["total_reviews"], 0)

    def test_create_and_delete_refresh_the_stats(self):
        self.assertEqual(self._stats()["total_reviews"], 0)

        with self.captureOnCommitCallbacks(execute=True):
            created = self.client.post(
                reverse("reviews-list"), {"anime_slug": self.anime.slug, "rating": 9}
            )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        stats = self._stats()
        self.assertEqual(stats["total_reviews"], 1)
        self.assertEqual(stats["distribution"][5], 1)

        with self.captureOnCommitCallbacks(execute=True):
            deleted = self.client.delete(reverse("reviews-detail", args=[created.data["id"]]))
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self._stats()["total_reviews"], 0)

    def test_update_refreshes_the_stats(self):
        review = Review.objects.create(user=self.user, anime=self.anime, rating=2)
        self.assertEqual(self._stats()["distribution"][1], 1)

        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(reverse("reviews-detail", args=[review.id]), {"rating": 10})

        stats = self._stats()
        self.assertEqual((stats["distribution"][1], stats["distribution"][5]), (0, 1))
