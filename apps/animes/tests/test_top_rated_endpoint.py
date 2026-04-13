from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import Anime


class TopRatedEndpointTests(APITestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_top_rated_uses_browse_quality_thresholds(self, _mock_enrich_metadata):
        Anime.objects.create(
            title="Thin Duplicate",
            slug="thin-duplicate",
            synopsis="High score but not enough traction.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            rating=9.9,
            member_count=50_000,
            external_links=[
                {
                    "site": "MyAnimeList",
                    "url": "https://myanimelist.net/anime/1/thin-duplicate",
                    "icon": "",
                }
            ],
        )
        strongest = Anime.objects.create(
            title="Curated Favorite",
            slug="curated-favorite",
            synopsis="Should top the public shelf.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            rating=9.5,
            member_count=900_000,
        )
        runner_up = Anime.objects.create(
            title="Runner Up",
            slug="runner-up",
            synopsis="Still qualifies for the curated shelf.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            rating=9.3,
            member_count=500_000,
        )

        response = self.client.get(reverse("anime-top-rated"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [row["title"] for row in response.data]

        self.assertEqual(titles[:2], [strongest.title, runner_up.title])
        self.assertNotIn("Thin Duplicate", titles)


class AnimeDetailExternalLinksTests(APITestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_detail_hides_lone_mal_link_for_bannerless_entry(self, _mock_enrich_metadata):
        anime = Anime.objects.create(
            title="Bannerless Duplicate",
            slug="bannerless-duplicate",
            synopsis="Incomplete duplicate row.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            rating=8.8,
            member_count=10_000,
            external_links=[
                {
                    "site": "MyAnimeList",
                    "url": "https://myanimelist.net/anime/2/bannerless-duplicate",
                    "icon": "",
                }
            ],
        )

        response = self.client.get(reverse("anime-detail", args=[anime.slug]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["external_links"], [])

    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_detail_keeps_lone_mal_link_when_banner_exists(self, _mock_enrich_metadata):
        anime = Anime.objects.create(
            title="Bannered Entry",
            slug="bannered-entry",
            synopsis="Has enough media to keep the fallback link.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            rating=8.8,
            member_count=250_000,
            banner_image_external_url="https://img.anilist.co/bannered-entry.jpg",
            external_links=[
                {
                    "site": "MyAnimeList",
                    "url": "https://myanimelist.net/anime/3/bannered-entry",
                    "icon": "",
                }
            ],
        )

        response = self.client.get(reverse("anime-detail", args=[anime.slug]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["external_links"]), 1)
        self.assertEqual(response.data["external_links"][0]["site"], "MyAnimeList")


class BrowseRowsPopularShelfTests(APITestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    def test_all_time_popular_row_excludes_low_member_count_entries(self, _mock_enrich_metadata):
        Anime.objects.create(
            title="Thin Popular Duplicate",
            slug="thin-popular-duplicate",
            synopsis="Has a rank but should not appear on the curated shelf.",
            anime_type=Anime.AnimeType.special,
            status=Anime.AnimeStatus.finished,
            popularity_rank=5,
            member_count=0,
            external_links=[
                {
                    "site": "MyAnimeList",
                    "url": "https://myanimelist.net/anime/4/thin-popular-duplicate",
                    "icon": "",
                }
            ],
        )
        strong = Anime.objects.create(
            title="Strong Popular Pick",
            slug="strong-popular-pick",
            synopsis="Should remain in the all-time popular row.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            popularity_rank=10,
            member_count=900_000,
        )

        response = self.client.get(reverse("anime-browse-rows"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        all_time_row = next(row for row in response.data if row["key"] == "all-time")
        titles = [row["title"] for row in all_time_row["anime_list"]]

        self.assertIn(strong.title, titles)
        self.assertNotIn("Thin Popular Duplicate", titles)
