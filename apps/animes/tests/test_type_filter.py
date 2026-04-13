from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ..models import Anime, Genre
from ..services.public_anime_service import ADULT_TAGS, AnimeQueryService
from ...users.models import UserProfile

User = get_user_model()


class AnimeTypeFilterTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.list_url = reverse("anime-list")
        self.base_params = {"sort": "title"}

        Anime.objects.create(
            title="Type TV Anime",
            slug="type-tv-anime",
            synopsis="TV anime",
            anime_type="TV",
            status="Airing",
            source_material="Manga",
            tags=["isekai", "male protagonist"],
            episode_count=24,
            duration_minutes=24,
            release_date=date(2023, 4, 1),
        )
        Anime.objects.create(
            title="Type Movie Anime",
            slug="type-movie-anime",
            synopsis="Movie anime",
            anime_type="Movie",
            status="Airing",
            source_material="Original",
            tags=["female protagonist"],
            episode_count=1,
            duration_minutes=120,
            release_date=date(2020, 1, 10),
        )
        Anime.objects.create(
            title="Type Special Anime",
            slug="type-special-anime",
            synopsis="Special anime",
            anime_type="Special",
            status="Airing",
            source_material="Manga",
            tags=["male protagonist"],
            episode_count=26,
            duration_minutes=24,
            release_date=date(2024, 10, 1),
        )
        Anime.objects.create(
            title="Type OVA Anime",
            slug="type-ova-anime",
            synopsis="OVA anime",
            anime_type="OVA",
            status="Airing",
            source_material="Light Novel",
            tags=["magic"],
            episode_count=12,
            duration_minutes=45,
            release_date=date(2021, 7, 12),
        )

    def test_type_filter_single_value_case_insensitive(self):
        response_upper = self.client.get(self.list_url, {**self.base_params, "type": "TV"})
        response_lower = self.client.get(self.list_url, {**self.base_params, "type": "tv"})

        self.assertEqual(response_upper.status_code, status.HTTP_200_OK)
        self.assertEqual(response_lower.status_code, status.HTTP_200_OK)

        upper_titles = {item["title"] for item in response_upper.data.get("results", [])}
        lower_titles = {item["title"] for item in response_lower.data.get("results", [])}

        self.assertIn("Type TV Anime", upper_titles)
        self.assertIn("Type TV Anime", lower_titles)
        self.assertNotIn("Type Movie Anime", upper_titles)
        self.assertNotIn("Type Special Anime", lower_titles)

    def test_type_filter_multiple_values(self):
        response = self.client.get(self.list_url, {**self.base_params, "type": "tv,movie"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertIn("Type TV Anime", titles)
        self.assertIn("Type Movie Anime", titles)
        self.assertNotIn("Type Special Anime", titles)

    def test_source_filter(self):
        response = self.client.get(self.list_url, {**self.base_params, "source": "Manga"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertSetEqual(titles, {"Type TV Anime", "Type Special Anime"})

    def test_tags_filter(self):
        response = self.client.get(self.list_url, {**self.base_params, "tags": "isekai"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertSetEqual(titles, {"Type TV Anime"})

    def test_detail_includes_tags(self):
        response = self.client.get(reverse("anime-detail", args=["type-tv-anime"]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get("tags"), ["isekai", "male protagonist"])

    def test_episode_range_filter(self):
        response = self.client.get(
            self.list_url,
            {**self.base_params, "min_episodes": "24", "max_episodes": "26"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertSetEqual(titles, {"Type TV Anime", "Type Special Anime"})

    def test_duration_range_filter(self):
        response = self.client.get(
            self.list_url,
            {**self.base_params, "min_duration": "20", "max_duration": "30"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertSetEqual(titles, {"Type TV Anime", "Type Special Anime"})

    def test_year_range_filter(self):
        response = self.client.get(
            self.list_url,
            {**self.base_params, "min_year": "2023", "max_year": "2024"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertSetEqual(titles, {"Type TV Anime", "Type Special Anime"})

    def test_year_range_filter_includes_metadata_only_rows(self):
        Anime.objects.create(
            title="Metadata Only Future Anime",
            slug="metadata-only-future-anime",
            synopsis="Release date not announced yet",
            anime_type="TV",
            status="Upcoming",
            release_date=None,
            season="SUMMER",
            season_year=2024,
        )

        response = self.client.get(
            self.list_url,
            {**self.base_params, "min_year": "2024", "max_year": "2024"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}

        self.assertIn("Metadata Only Future Anime", titles)

    def test_popular_sort_with_genre_filter_includes_rows_without_popularity_rank(self):
        hentai = Genre.objects.create(name="Hentai", slug="hentai")
        viewer = User.objects.create_user(username="adultviewer", password="password123")
        UserProfile.objects.update_or_create(user=viewer, defaults={"show_adult_content": True})
        self.client.force_authenticate(user=viewer)

        higher_members = Anime.objects.create(
            title="Hentai Entry High Members",
            slug="hentai-entry-high-members",
            synopsis="High member count hentai entry",
            anime_type="OVA",
            status="Finished",
            member_count=5000,
            popularity_rank=None,
        )
        lower_members = Anime.objects.create(
            title="Hentai Entry Low Members",
            slug="hentai-entry-low-members",
            synopsis="Low member count hentai entry",
            anime_type="OVA",
            status="Finished",
            member_count=1000,
            popularity_rank=None,
        )
        higher_members.genres.add(hentai)
        lower_members.genres.add(hentai)

        response = self.client.get(self.list_url, {"sort": "popular", "genre": "hentai"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", [])
        titles = [item["title"] for item in results]

        self.assertIn("Hentai Entry High Members", titles)
        self.assertIn("Hentai Entry Low Members", titles)
        self.assertLess(
            titles.index("Hentai Entry High Members"),
            titles.index("Hentai Entry Low Members"),
        )

    def test_adult_themed_anime_is_hidden_from_browse_by_default(self):
        hentai = Genre.objects.create(name="Hentai", slug="hentai")
        hidden = Anime.objects.create(
            title="Hidden Explicit Anime",
            slug="hidden-explicit-anime",
            synopsis="Should not appear by default",
            anime_type="OVA",
            status="Finished",
            tags=["fellatio", "nakadashi"],
            release_date=date(2022, 1, 1),
        )
        hidden.genres.add(hentai)

        visible = Anime.objects.create(
            title="Visible General Anime",
            slug="visible-general-anime",
            synopsis="Safe to browse",
            anime_type="TV",
            status="Finished",
            tags=["heterosexual"],
            release_date=date(2022, 1, 2),
        )

        response = self.client.get(self.list_url, self.base_params)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}
        self.assertIn(visible.title, titles)
        self.assertNotIn(hidden.title, titles)

    def test_harmless_relationship_tags_remain_visible_by_default(self):
        anime = Anime.objects.create(
            title="Relationship Tag Anime",
            slug="relationship-tag-anime",
            synopsis="Should remain visible",
            anime_type="TV",
            status="Finished",
            tags=["heterosexual", "male protagonist"],
            release_date=date(2022, 1, 4),
        )

        response = self.client.get(self.list_url, {**self.base_params, "q": "Relationship"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}
        self.assertIn(anime.title, titles)

    def test_ecchi_anime_remains_visible_by_default(self):
        ecchi = Genre.objects.create(name="Ecchi", slug="ecchi")
        anime = Anime.objects.create(
            title="Visible Ecchi Anime",
            slug="visible-ecchi-anime",
            synopsis="Suggestive but not explicit hentai",
            anime_type="TV",
            status="Finished",
            tags=["nudity", "heterosexual"],
            release_date=date(2022, 1, 5),
        )
        anime.genres.add(ecchi)

        response = self.client.get(self.list_url, {**self.base_params, "q": "Visible Ecchi"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}
        self.assertIn(anime.title, titles)

    def test_opted_in_user_can_browse_adult_themed_anime(self):
        viewer = User.objects.create_user(username="opted-in-viewer", password="password123")
        UserProfile.objects.update_or_create(user=viewer, defaults={"show_adult_content": True})
        self.client.force_authenticate(user=viewer)

        anime = Anime.objects.create(
            title="Opted In Adult Anime",
            slug="opted-in-adult-anime",
            synopsis="Visible after opt in",
            anime_type="OVA",
            status="Finished",
            tags=["ecchi"],
            release_date=date(2022, 1, 3),
        )

        response = self.client.get(self.list_url, self.base_params)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item["title"] for item in response.data.get("results", [])}
        self.assertIn(anime.title, titles)

    def test_postgres_adult_tag_filter_uses_single_has_any_keys_lookup(self):
        with patch("apps.animes.services.public_anime_service.connections") as mock_connections:
            mock_connections.__getitem__.return_value.vendor = "postgresql"

            condition = AnimeQueryService._adult_tags_q("default")

        self.assertEqual(condition.children, [("tags__has_any_keys", sorted(ADULT_TAGS))])
