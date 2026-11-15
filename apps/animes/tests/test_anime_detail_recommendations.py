from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from ...users.models import UserAnimeList
from ..models import Anime, Genre, UserFavorite
from ..services.relation_links import set_relations

User = get_user_model()

RECOMMENDATIONS_PATH = (
    "apps.animes.services.public_anime_service.AniListService.get_recommendations_for_anime"
)


class AnimeDetailRecommendationsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="reco-user",
            email="reco@example.com",
            password="password123",
        )
        self.genre = Genre.objects.create(name="Adventure", slug="adventure")

        self.anime = Anime.objects.create(
            title="Frieren",
            slug="frieren",
            synopsis="Base anime",
            anime_type="TV",
            status="Finished",
            anilist_id=100,
            mal_id=1100,
        )
        self.anime.genres.add(self.genre)

        self.franchise_entry = Anime.objects.create(
            title="Frieren Season 2",
            slug="frieren-season-2",
            synopsis="Franchise sequel",
            anime_type="TV",
            status="Upcoming",
            anilist_id=200,
            mal_id=1200,
            rating=8.8,
        )
        self.franchise_entry.genres.add(self.genre)
        set_relations(
            self.anime,
            [{"id": 200, "mal_id": 1200, "type": "SEQUEL", "title": "Frieren Season 2"}],
        )

        self.anilist_recommendation = Anime.objects.create(
            title="Delicious in Dungeon",
            slug="delicious-in-dungeon",
            synopsis="Real recommendation",
            anime_type="TV",
            status="Finished",
            anilist_id=300,
            mal_id=1300,
            rating=8.9,
        )
        self.anilist_recommendation.genres.add(self.genre)

        self.fallback_recommendation = Anime.objects.create(
            title="Mushi-Shi",
            slug="mushi-shi",
            synopsis="Genre fallback recommendation",
            anime_type="TV",
            status="Finished",
            anilist_id=400,
            mal_id=1400,
            rating=8.7,
        )
        self.fallback_recommendation.genres.add(self.genre)

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_anilist_recommendations_exclude_franchise_entries(self, mock_get_recommendations):
        mock_get_recommendations.return_value = [
            {"id": 200, "mal_id": 1200, "title": "Frieren Season 2"},
            {"id": 300, "mal_id": 1300, "title": "Delicious in Dungeon"},
            {"id": 100, "mal_id": 1100, "title": "Frieren"},
        ]

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["slug"] for item in response.data],
            [self.anilist_recommendation.slug],
        )
        mock_get_recommendations.assert_called_once_with(
            self.anime.anilist_id,
            mal_id=self.anime.mal_id,
            limit=12,
            request_budget="interactive",
        )

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_recommendations_keep_anilist_order_and_match_by_mal_id_too(
        self, mock_get_recommendations
    ):
        mal_only = Anime.objects.create(
            title="Legacy MAL Row",
            slug="legacy-mal-row",
            synopsis="Only a MAL ID",
            anime_type="TV",
            status="Finished",
            mal_id=1500,
        )
        mock_get_recommendations.return_value = [
            {"id": 999, "mal_id": 1500, "title": "Legacy MAL Row"},
            {"id": 300, "mal_id": None, "title": "Delicious in Dungeon"},
            {"id": 12345, "mal_id": None, "title": "Not in the catalog"},
        ]

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(
            [item["slug"] for item in response.data],
            [mal_only.slug, self.anilist_recommendation.slug],
        )

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_linked_relations_are_excluded_even_without_a_mal_id(self, mock_get_recommendations):
        set_relations(self.anime, [{"id": 300, "type": "SIDE_STORY", "title": "Delicious"}])
        mock_get_recommendations.return_value = [{"id": 300, "mal_id": None}]

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertNotIn(self.anilist_recommendation.slug, [item["slug"] for item in response.data])

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_anime_without_ids_skips_anilist(self, mock_get_recommendations):
        loner = Anime.objects.create(
            title="No IDs", slug="no-ids", synopsis="x", anime_type="TV", status="Finished"
        )
        loner.genres.add(self.genre)

        response = self.client.get(reverse("anime-recommendations", args=[loner.slug]))

        self.assertEqual(response.status_code, 200)
        mock_get_recommendations.assert_not_called()
        self.assertIn(self.fallback_recommendation.slug, [item["slug"] for item in response.data])

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_fallback_recommendations_also_exclude_franchise_entries(
        self, mock_get_recommendations
    ):
        mock_get_recommendations.return_value = []

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        returned_slugs = [item["slug"] for item in response.data]

        self.assertIn(self.fallback_recommendation.slug, returned_slugs)
        self.assertNotIn(self.franchise_entry.slug, returned_slugs)
        self.assertNotIn(self.anime.slug, returned_slugs)

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_timeout_uses_fallback_recommendations(self, mock_get_recommendations):
        mock_get_recommendations.side_effect = TimeoutError("AniList timed out")

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        returned_slugs = [item["slug"] for item in response.data]

        self.assertIn(self.fallback_recommendation.slug, returned_slugs)
        self.assertNotIn(self.franchise_entry.slug, returned_slugs)

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_public_recommendations_include_cache_control_header(self, mock_get_recommendations):
        mock_get_recommendations.return_value = [{"id": 300, "title": "Delicious in Dungeon"}]

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        self.assertIn("public, max-age=300", response["Cache-Control"])

    @patch(RECOMMENDATIONS_PATH, new_callable=MagicMock)
    def test_authenticated_recommendations_include_user_context(self, mock_get_recommendations):
        mock_get_recommendations.return_value = [{"id": 300, "title": "Delicious in Dungeon"}]
        UserFavorite.objects.create(user=self.user, anime=self.anilist_recommendation)
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.anilist_recommendation,
            status=UserAnimeList.UserAnimeStatus.watching,
            episodes_watched=4,
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(reverse("anime-recommendations", args=[self.anime.slug]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["slug"], self.anilist_recommendation.slug)
        self.assertTrue(response.data[0]["is_favorite"])
        self.assertEqual(response.data[0]["user_list_status"]["status"], "Watching")
        self.assertEqual(response.data[0]["user_list_status"]["episodes_watched"], 4)
