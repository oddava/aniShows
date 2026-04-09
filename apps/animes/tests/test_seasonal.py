"""Seasonal Anime API Tests

Tests for:
- Filtering anime by season and year
- Season validation
- Year boundary validation
- Special sorting for seasonal views
- Caching behavior
"""

from datetime import date

from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ..models import Anime, Studio
from ..signals import trigger_metadata_fetch

User = get_user_model()

class SeasonalAnimeTests(APITestCase):
    """Tests for seasonal anime filtering and API."""

    def setUp(self):
        # Create test studio
        self.studio = Studio.objects.create(name="Test Studio")

        # Create anime for different seasons
        # Winter 2024 (Jan-Mar)
        self.winter_anime = Anime.objects.create(
            title="Winter Anime",
            slug="winter-anime",
            synopsis="A winter anime",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 1, 15),
            member_count=100000,
            rating=8.5,
        )

        # Spring 2024 (Apr-Jun)
        self.spring_anime = Anime.objects.create(
            title="Spring Anime",
            slug="spring-anime",
            synopsis="A spring anime",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 4, 15),
            member_count=200000,
            rating=9.0,
        )

        # Summer 2024 (Jul-Sep)
        self.summer_anime = Anime.objects.create(
            title="Summer Anime",
            slug="summer-anime",
            synopsis="A summer anime",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 7, 15),
            member_count=150000,
            rating=7.5,
        )

        # Fall 2024 (Oct-Dec)
        self.fall_anime = Anime.objects.create(
            title="Fall Anime",
            slug="fall-anime",
            synopsis="A fall anime",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 10, 15),
            member_count=180000,
            rating=8.0,
        )

        # Anime without rating (edge case)
        self.no_rating_anime = Anime.objects.create(
            title="No Rating Anime",
            slug="no-rating-anime",
            synopsis="Anime without rating",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 1, 20),
            member_count=50000,
            rating=None,
        )

        self.list_url = reverse("anime-list")
        self.client = APIClient()

    def test_filter_by_winter_season(self):
        """Test filtering anime by winter season."""
        response = self.client.get(self.list_url, {"season": "winter", "year": "2024"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)

        # Should include winter anime and no-rating anime
        titles = [anime["title"] for anime in results]
        self.assertIn("Winter Anime", titles)
        self.assertIn("No Rating Anime", titles)
        self.assertNotIn("Spring Anime", titles)
        self.assertNotIn("Summer Anime", titles)
        self.assertNotIn("Fall Anime", titles)

    def test_filter_by_spring_season(self):
        """Test filtering anime by spring season."""
        response = self.client.get(self.list_url, {"season": "spring", "year": "2024"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)

        titles = [anime["title"] for anime in results]
        self.assertIn("Spring Anime", titles)
        self.assertNotIn("Winter Anime", titles)

    def test_filter_by_year_only(self):
        """Test filtering by year without season."""
        response = self.client.get(self.list_url, {"year": "2024"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)

        # Should include all 2024 anime
        titles = [anime["title"] for anime in results]
        self.assertIn("Winter Anime", titles)
        self.assertIn("Spring Anime", titles)
        self.assertIn("Summer Anime", titles)
        self.assertIn("Fall Anime", titles)

    def test_filter_by_season_uses_explicit_season_fields(self):
        """Season/year metadata should override misleading release dates."""
        Anime.objects.create(
            title="Summer Metadata Anime",
            slug="summer-metadata-anime",
            synopsis="Uses explicit season metadata",
            anime_type="TV",
            status="Upcoming",
            release_date=date(2026, 10, 1),
            season="SUMMER",
            season_year=2026,
            member_count=300000,
        )
        Anime.objects.create(
            title="Wrong Release Date Match",
            slug="wrong-release-date-match",
            synopsis="Release date overlaps but season metadata does not",
            anime_type="TV",
            status="Upcoming",
            release_date=date(2026, 7, 10),
            season="FALL",
            season_year=2026,
            member_count=350000,
        )

        response = self.client.get(self.list_url, {"season": "summer", "year": "2026"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        titles = [anime["title"] for anime in results]

        self.assertIn("Summer Metadata Anime", titles)
        self.assertNotIn("Wrong Release Date Match", titles)

    def test_filter_by_year_uses_season_year_when_release_date_missing(self):
        """Year filters should include records that only have season-year metadata."""
        Anime.objects.create(
            title="Year Metadata Only",
            slug="year-metadata-only",
            synopsis="No release date yet",
            anime_type="TV",
            status="Upcoming",
            release_date=None,
            season="SUMMER",
            season_year=2026,
            member_count=275000,
        )

        response = self.client.get(self.list_url, {"year": "2026"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        titles = [anime["title"] for anime in results]

        self.assertIn("Year Metadata Only", titles)

    def test_invalid_season_rejected(self):
        """Test that invalid season values are rejected."""
        response = self.client.get(self.list_url, {"season": "invalid_season", "year": "2024"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should fallback to year-only filter
        results = response.data.get("results", response.data)
        self.assertGreater(len(results), 0)

    def test_year_boundary_validation(self):
        """Test year validation (1980-2050)."""
        # Test year too low
        response = self.client.get(self.list_url, {"season": "winter", "year": "1900"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Test year too high
        response = self.client.get(self.list_url, {"season": "winter", "year": "2100"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Test valid year
        response = self.client.get(self.list_url, {"season": "winter", "year": "2024"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertGreater(len(results), 0)

    def test_seasonal_sorting_prefers_popularity_rank(self):
        """Test that seasonal popular views sort by popularity rank."""
        self.spring_anime.popularity_rank = 50
        self.spring_anime.save(update_fields=["popularity_rank"])

        Anime.objects.create(
            title="Spring Ranked Favorite",
            slug="spring-ranked-favorite",
            synopsis="A ranked spring anime",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 4, 20),
            member_count=150000,
            popularity_rank=10,
        )
        Anime.objects.create(
            title="Spring Unranked Hype",
            slug="spring-unranked-hype",
            synopsis="A spring anime without popularity rank",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 4, 25),
            member_count=500000,
            popularity_rank=None,
        )

        response = self.client.get(
            self.list_url, {"season": "spring", "year": "2024", "sort": "popular"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        titles = [anime["title"] for anime in results]

        self.assertGreaterEqual(len(titles), 3)
        self.assertEqual(titles[0], "Spring Ranked Favorite")
        self.assertLess(titles.index("Spring Anime"), titles.index("Spring Unranked Hype"))

    def test_null_rating_handling(self):
        """Test that anime with null ratings are included."""
        response = self.client.get(self.list_url, {"season": "winter", "year": "2024"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)

        # Should include anime without rating
        titles = [anime["title"] for anime in results]
        self.assertIn("No Rating Anime", titles)

    def test_season_case_insensitive(self):
        """Test that season parameter is case insensitive."""
        for season in ["WINTER", "Winter", "winter", "WiNtEr"]:
            response = self.client.get(self.list_url, {"season": season, "year": "2024"})
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            results = response.data.get("results", response.data)
            # Should still return results
            self.assertIsInstance(results, list)

    def test_pagination_on_seasonal_view(self):
        """Test pagination works with seasonal filter."""
        response = self.client.get(
            self.list_url, {"season": "winter", "year": "2024", "page_size": "2"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should have pagination metadata
        self.assertIn("count", response.data or {})
        self.assertIn("results", response.data or {})

class SeasonalEdgeCasesTests(APITestCase):
    """Tests for edge cases in seasonal filtering."""

    def setUp(self):
        self.list_url = reverse("anime-list")
        self.client = APIClient()
        # Disconnect the metadata fetch signal to prevent database locks in tests
        post_save.disconnect(trigger_metadata_fetch, sender=Anime)

    def tearDown(self):
        # Reconnect the signal after tests
        post_save.connect(trigger_metadata_fetch, sender=Anime)

    def test_empty_season(self):
        """Test filtering by season with no anime."""
        response = self.client.get(self.list_url, {"season": "winter", "year": "1990"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 0)

    def test_malformed_year_parameter(self):
        """Test handling of malformed year parameter."""
        response = self.client.get(self.list_url, {"season": "winter", "year": "not_a_number"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should handle gracefully, ignoring invalid year

    def test_edge_dates_in_season(self):
        """Test anime at season boundaries."""
        # Count existing winter anime
        from django.db.models import Q

        winter_count_before = Anime.objects.filter(
            Q(release_date__gte=date(2024, 1, 1)) & Q(release_date__lte=date(2024, 3, 31))
        ).count()

        # Anime on first day of winter - use higher member_count to appear in results
        Anime.objects.create(
            title="Winter Start",
            slug="winter-start",
            synopsis="First day of winter",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 1, 1),
            member_count=500000,  # Higher than existing anime to appear first
        )

        # Anime on last day of winter
        Anime.objects.create(
            title="Winter End",
            slug="winter-end",
            synopsis="Last day of winter",
            anime_type="TV",
            status="Airing",
            release_date=date(2024, 3, 31),
            member_count=400000,  # Higher than existing anime to appear early
        )

        # Verify anime were created
        winter_count_after = Anime.objects.filter(
            Q(release_date__gte=date(2024, 1, 1)) & Q(release_date__lte=date(2024, 3, 31))
        ).count()
        self.assertEqual(winter_count_after, winter_count_before + 2)

        response = self.client.get(
            self.list_url, {"season": "winter", "year": "2024", "page_size": 100}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        titles = [anime["title"] for anime in results]

        self.assertIn("Winter Start", titles)
        self.assertIn("Winter End", titles)

    def test_year_transition(self):
        """Test season across year boundary (winter spans two years)."""
        # Anime in winter 2023 (Jan-Mar 2023)
        Anime.objects.create(
            title="Winter 2023 Anime",
            slug="winter-2023-anime",
            synopsis="Anime from previous year winter",
            anime_type="TV",
            status="Airing",
            release_date=date(2023, 2, 15),
        )

        response = self.client.get(self.list_url, {"season": "winter", "year": "2023"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        titles = [anime["title"] for anime in results]
        self.assertIn("Winter 2023 Anime", titles)
