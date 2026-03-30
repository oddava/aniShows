from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from apps.animes.models import Anime


class AnimeTypeFilterTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.list_url = reverse("anime-list")

        Anime.objects.create(
            title="Type TV Anime",
            slug="type-tv-anime",
            synopsis="TV anime",
            anime_type="TV",
            status="Airing",
        )
        Anime.objects.create(
            title="Type Movie Anime",
            slug="type-movie-anime",
            synopsis="Movie anime",
            anime_type="Movie",
            status="Airing",
        )
        Anime.objects.create(
            title="Type Special Anime",
            slug="type-special-anime",
            synopsis="Special anime",
            anime_type="Special",
            status="Airing",
        )

    def test_type_filter_single_value_case_insensitive(self):
        response_upper = self.client.get(self.list_url, {"type": "TV"})
        response_lower = self.client.get(self.list_url, {"type": "tv"})

        self.assertEqual(response_upper.status_code, status.HTTP_200_OK)
        self.assertEqual(response_lower.status_code, status.HTTP_200_OK)

        upper_titles = {item["title"] for item in response_upper.data.get("results", [])}
        lower_titles = {item["title"] for item in response_lower.data.get("results", [])}

        self.assertIn("Type TV Anime", upper_titles)
        self.assertIn("Type TV Anime", lower_titles)
        self.assertNotIn("Type Movie Anime", upper_titles)
        self.assertNotIn("Type Special Anime", lower_titles)

    def test_type_filter_multiple_values(self):
        response = self.client.get(self.list_url, {"type": "tv,movie"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertIn("Type TV Anime", titles)
        self.assertIn("Type Movie Anime", titles)
        self.assertNotIn("Type Special Anime", titles)
