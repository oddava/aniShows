from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import Anime, OfflineAnimeSyncState, UserRecommendation
from ..services.recommendations import RecommendationService

User = get_user_model()


class QuarantinedAnimeVisibilityTests(APITestCase):
    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "test synopsis",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "member_count": 250_000,
            "popularity_rank": 100,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def _quarantine(self, anime: Anime):
        OfflineAnimeSyncState.objects.create(
            anime=anime,
            metadata_status=OfflineAnimeSyncState.StageStatus.QUARANTINED,
            franchise_status=OfflineAnimeSyncState.StageStatus.PENDING,
            themes_status=OfflineAnimeSyncState.StageStatus.PENDING,
            quarantined=True,
            quarantine_reason="test_quarantine",
        )

    def test_public_anime_list_excludes_quarantined_rows(self):
        visible = self._anime("Visible Anime")
        hidden = self._anime("Hidden Anime")
        self._quarantine(hidden)

        response = self.client.get(reverse("anime-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        titles = [row["title"] for row in response.data["results"]]
        self.assertIn(visible.title, titles)
        self.assertNotIn(hidden.title, titles)

    def test_public_anime_search_excludes_quarantined_rows(self):
        visible = self._anime("Searchable Visible")
        hidden = self._anime("Searchable Hidden")
        self._quarantine(hidden)

        response = self.client.get(reverse("anime-list"), {"q": "Searchable"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        titles = [row["title"] for row in response.data["results"]]
        self.assertIn(visible.title, titles)
        self.assertNotIn(hidden.title, titles)

    def test_public_anime_detail_returns_404_for_quarantined_row(self):
        visible = self._anime("Visible Detail")
        hidden = self._anime("Hidden Detail")
        self._quarantine(hidden)

        visible_response = self.client.get(reverse("anime-detail", args=[visible.slug]))
        hidden_response = self.client.get(reverse("anime-detail", args=[hidden.slug]))

        self.assertEqual(visible_response.status_code, status.HTTP_200_OK)
        self.assertEqual(hidden_response.status_code, status.HTTP_404_NOT_FOUND)


class ShadowDuplicateVisibilityTests(APITestCase):
    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-").replace("'", "").replace("’", ""),
            "synopsis": "test synopsis",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "member_count": 250_000,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def test_public_anime_list_excludes_shadow_duplicate_when_bannered_canonical_exists(self):
        canonical = self._anime(
            "Frieren: Beyond Journey’s End",
            slug="frieren-beyond-journeys-end",
            anilist_id=154587,
            mal_id=52991,
            banner_image_external_url="https://img.anilist.co/banner.jpg",
            provider_ids={"anilist": 154587, "myanimelist": 52991},
        )
        shadow = self._anime(
            "Frieren: Beyond Journey's End",
            slug="frieren-beyond-journeys-end-2",
            anilist_id=Anime.JIKAN_ANILIST_ID_OFFSET + 52991,
            provider_ids={"jikan": 52991, "myanimelist": 52991},
        )

        response = self.client.get(reverse("anime-list"), {"q": "Frieren"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        titles = [row["title"] for row in response.data["results"]]
        self.assertIn(canonical.title, titles)
        self.assertNotIn(shadow.title, titles)

    def test_public_anime_detail_returns_404_for_shadow_duplicate_when_canonical_exists(self):
        self._anime(
            "Frieren: Beyond Journey’s End",
            slug="frieren-beyond-journeys-end",
            anilist_id=154587,
            mal_id=52991,
            banner_image_external_url="https://img.anilist.co/banner.jpg",
            provider_ids={"anilist": 154587, "myanimelist": 52991},
        )
        shadow = self._anime(
            "Frieren: Beyond Journey's End",
            slug="frieren-beyond-journeys-end-2",
            anilist_id=Anime.JIKAN_ANILIST_ID_OFFSET + 52991,
            provider_ids={"jikan": 52991, "myanimelist": 52991},
        )

        response = self.client.get(reverse("anime-detail", args=[shadow.slug]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_public_anime_list_excludes_shadow_duplicate_even_without_banner_on_canonical(self):
        canonical = self._anime(
            "One Punch Man",
            slug="one-punch-man",
            anilist_id=21087,
            mal_id=30276,
            provider_ids={"anilist": 21087, "myanimelist": 30276},
        )
        shadow = self._anime(
            "One Punch Man",
            slug="one-punch-man-jikan",
            anilist_id=Anime.JIKAN_ANILIST_ID_OFFSET + 30276,
            provider_ids={"jikan": 30276, "myanimelist": 30276},
        )

        response = self.client.get(reverse("anime-list"), {"q": "One Punch Man"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        titles = [row["title"] for row in response.data["results"]]
        slugs = [row["slug"] for row in response.data["results"]]
        self.assertIn(canonical.title, titles)
        self.assertIn(canonical.slug, slugs)
        self.assertNotIn(shadow.slug, slugs)


class QuarantinedRecommendationTests(APITestCase):
    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "test synopsis",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "rating": 8.0,
            "site_rank": 100,
            "trending_rank": 50,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def _quarantine(self, anime: Anime):
        OfflineAnimeSyncState.objects.create(
            anime=anime,
            metadata_status=OfflineAnimeSyncState.StageStatus.QUARANTINED,
            franchise_status=OfflineAnimeSyncState.StageStatus.PENDING,
            themes_status=OfflineAnimeSyncState.StageStatus.PENDING,
            quarantined=True,
            quarantine_reason="test_quarantine",
        )

    def setUp(self):
        self.user = User.objects.create_user(
            username="rec-user",
            email="rec@example.com",
            password="password123",
        )

    def test_fallback_recommendations_exclude_quarantined_anime(self):
        visible = self._anime("Visible Recommendation")
        hidden = self._anime("Hidden Recommendation")
        self._quarantine(hidden)

        service = RecommendationService()
        recs = service.content_recommender._get_fallback_recommendations(limit=10)
        anime_ids = [rec["anime"].id for rec in recs]

        self.assertIn(visible.id, anime_ids)
        self.assertNotIn(hidden.id, anime_ids)

    def test_cached_user_recommendations_exclude_quarantined_anime(self):
        visible = self._anime("Visible Cached Recommendation")
        hidden = self._anime("Hidden Cached Recommendation")
        self._quarantine(hidden)

        UserRecommendation.objects.create(
            user=self.user,
            anime=visible,
            score=80,
            reason=UserRecommendation.RecommendationReason.TOP_RATED,
        )
        UserRecommendation.objects.create(
            user=self.user,
            anime=hidden,
            score=90,
            reason=UserRecommendation.RecommendationReason.TOP_RATED,
        )

        recs = RecommendationService().get_recommendations_for_user(self.user, limit=10)
        anime_ids = [rec.anime_id for rec in recs]

        self.assertIn(visible.id, anime_ids)
        self.assertNotIn(hidden.id, anime_ids)
