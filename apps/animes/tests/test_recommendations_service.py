from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.test import APITestCase

from ...users.models import UserAnimeList
from ..models import Anime, Genre, Studio, UserRecommendation
from ..services.offline_catalog import PLACEHOLDER_SYNOPSIS
from ..services.recommendations import RecommendationService

User = get_user_model()


class RecommendationServiceQualityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="rec-quality-user",
            email="rec-quality@example.com",
            password="password123",
        )
        self.studio_a = Studio.objects.create(name="Studio A")
        self.studio_b = Studio.objects.create(name="Studio B")
        self.genre_action = Genre.objects.create(name="Action", slug="action")
        self.genre_fantasy = Genre.objects.create(name="Fantasy", slug="fantasy")

    def _anime(self, title: str, genres: list[Genre] | None = None, **overrides) -> Anime:
        genres = genres or []
        payload = {
            "title": title,
            "slug": slugify(title),
            "synopsis": "test synopsis",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "rating": 8.4,
            "member_count": 300_000,
            "popularity_rank": 250,
            "site_rank": 180,
            "trending_rank": 120,
            "release_date": date(2020, 1, 1),
        }
        studio = overrides.pop("studio", self.studio_a)
        payload.update(overrides)
        anime = Anime.objects.create(**payload)
        anime.set_studios([studio])
        if genres:
            anime.genres.set(genres)
        return anime

    def _add_positive_list_entry(self, anime: Anime, score: int = 9):
        UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=UserAnimeList.UserAnimeStatus.completed,
            score=score,
        )

    def test_recommender_excludes_placeholder_synopsis_candidates(self):
        anchor = self._anime("Anchor Favorite", genres=[self.genre_action])
        self._add_positive_list_entry(anchor, score=9)

        good = self._anime("Good Candidate", genres=[self.genre_action, self.genre_fantasy])
        placeholder = self._anime(
            "Placeholder Candidate",
            genres=[self.genre_action],
            synopsis=PLACEHOLDER_SYNOPSIS,
        )

        recs = RecommendationService().content_recommender.get_recommendations_for_user(self.user, limit=20)
        rec_ids = [row["anime"].id for row in recs]

        self.assertIn(good.id, rec_ids)
        self.assertNotIn(placeholder.id, rec_ids)

    def test_recommender_prefers_quality_over_newest_bias(self):
        anchor = self._anime("Quality Anchor", genres=[self.genre_action])
        self._add_positive_list_entry(anchor, score=9)

        high_quality_older = self._anime(
            "High Quality Older",
            genres=[self.genre_action],
            release_date=date(2016, 1, 1),
            member_count=500_000,
            popularity_rank=90,
            site_rank=70,
            trending_rank=60,
        )
        weak_newer = self._anime(
            "Weak Newer",
            genres=[self.genre_action],
            release_date=date(2026, 1, 1),
            member_count=9_000,
            popularity_rank=None,
            site_rank=None,
            trending_rank=None,
            studio=self.studio_b,
        )

        recs = RecommendationService().content_recommender.get_recommendations_for_user(self.user, limit=20)
        by_id = {row["anime"].id: row for row in recs}

        self.assertIn(high_quality_older.id, by_id)
        if weak_newer.id in by_id:
            self.assertGreater(by_id[high_quality_older.id]["score"], by_id[weak_newer.id]["score"])

    def test_recommender_biases_toward_dominant_user_format(self):
        anchor = self._anime("TV Anchor", genres=[self.genre_fantasy], anime_type=Anime.AnimeType.tv)
        self._add_positive_list_entry(anchor, score=9)

        tv_candidate = self._anime(
            "TV Candidate",
            genres=[self.genre_fantasy],
            anime_type=Anime.AnimeType.tv,
        )
        movie_candidate = self._anime(
            "Movie Candidate",
            genres=[self.genre_fantasy],
            anime_type=Anime.AnimeType.movie,
        )

        recs = RecommendationService().content_recommender.get_recommendations_for_user(self.user, limit=20)
        ordered_ids = [row["anime"].id for row in recs]

        self.assertIn(tv_candidate.id, ordered_ids)
        if movie_candidate.id in ordered_ids:
            self.assertLess(ordered_ids.index(tv_candidate.id), ordered_ids.index(movie_candidate.id))

    def test_recommender_sets_because_you_liked_reason_with_source_anime(self):
        anchor = self._anime("Source Anchor", genres=[self.genre_action, self.genre_fantasy])
        self._add_positive_list_entry(anchor, score=10)

        candidate = self._anime(
            "Anchor Similar Candidate",
            genres=[self.genre_action, self.genre_fantasy],
            studio=self.studio_a,
            anime_type=Anime.AnimeType.tv,
            member_count=450_000,
            popularity_rank=75,
            site_rank=65,
            trending_rank=55,
        )

        recs = RecommendationService().content_recommender.get_recommendations_for_user(self.user, limit=20)
        match = next((row for row in recs if row["anime"].id == candidate.id), None)

        self.assertIsNotNone(match)
        self.assertEqual(match["reason"], UserRecommendation.RecommendationReason.BECAUSE_YOU_LIKED)
        self.assertEqual(match["metadata"].get("source_anime"), anchor.title)
        self.assertGreater(match["metadata"].get("confidence", 0), 0)

    def test_get_recommendations_refreshes_when_cached_recommendations_are_stale(self):
        anime = self._anime("Stale Recommendation", genres=[self.genre_action])
        stale_rec = UserRecommendation.objects.create(
            user=self.user,
            anime=anime,
            score=80,
            reason=UserRecommendation.RecommendationReason.TOP_RATED,
        )
        UserRecommendation.objects.filter(id=stale_rec.id).update(
            created_at=timezone.now() - timedelta(days=2)
        )

        service = RecommendationService()
        with patch.object(service, "generate_for_user", return_value=[]) as mock_generate:
            recs = service.get_recommendations_for_user(self.user, limit=10)

        self.assertEqual(len(recs), 1)
        self.assertTrue(mock_generate.called)
