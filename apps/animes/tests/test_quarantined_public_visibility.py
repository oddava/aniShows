from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.animes.models import Anime, OfflineAnimeSyncState, UserRecommendation
from apps.animes.services.recommendations import RecommendationService

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
