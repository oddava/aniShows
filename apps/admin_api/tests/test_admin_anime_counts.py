"""Admin anime list counts are not multiplied by each other (G6 P1-5, A13)."""

from unittest.mock import patch

from django.test import TestCase

from ...animes.models import Anime, Review, UserFavorite
from .helpers import bearer_client, make_user


class AdminAnimeCountsTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.request_hydrate", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_two_favorites_and_three_reviews_count_as_two_and_three(self):
        anime = Anime.objects.create(
            title="Counted", slug="counted", synopsis="x", status="Airing", anime_type="TV"
        )
        for index in range(2):
            UserFavorite.objects.create(user=make_user(f"fan{index}"), anime=anime)
        for index, rating in enumerate((6, 8, 10)):
            Review.objects.create(
                user=make_user(f"critic{index}"), anime=anime, rating=rating, text="t"
            )
        client = bearer_client(make_user("counts-staff", role="staff"))

        listed = client.get("/api/v1/admin/anime/").data["results"][0]
        detail = client.get(f"/api/v1/admin/anime/{anime.id}/").data

        for row in (listed, detail):
            self.assertEqual((row["favorites_count"], row["reviews_count"]), (2, 3))
            self.assertEqual(float(row["avg_review_rating"]), 8.0)
