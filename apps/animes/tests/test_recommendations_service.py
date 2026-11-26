from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.test import APITestCase

from ...users.models import UserAnimeList, UserProfile
from ..models import Anime, AnimeRelation, Genre, Studio, UserRecommendation
from ..services.metadata_health import PLACEHOLDER_SYNOPSIS
from ..services.recommendations import FILLER_SCORE_CEILING, RecommendationService

User = get_user_model()


class RecommendationFixtures:
    """Catalogue and list helpers shared by the recommendation test modules.

    List and favourite saves queue a generation through the signals; with eager Celery
    that would run inside the fixture, so the task is replaced by a mock here.
    """

    def setUp(self):
        super().setUp()
        patcher = patch("apps.animes.signals.generate_recommendations")
        self.signal_task = patcher.start()
        self.addCleanup(patcher.stop)

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

    def _add_positive_list_entry(self, anime: Anime, score: int = 9, user=None):
        UserAnimeList.objects.create(
            user=user or self.user,
            anime=anime,
            status=UserAnimeList.UserAnimeStatus.completed,
            score=score,
        )

    def _prequel(self, anime: Anime, prequel: Anime, relation_type: str = "PREQUEL"):
        AnimeRelation.objects.create(
            from_anime=anime,
            to_anime=prequel,
            relation_type=relation_type,
            target_anilist_id=prequel.id,
            title=prequel.title,
        )

    @staticmethod
    def _make_adult(anime: Anime) -> None:
        Anime.objects.filter(pk=anime.pk).update(is_adult=True)

    def _allow_adult(self, user=None) -> None:
        UserProfile.objects.update_or_create(
            user=user or self.user, defaults={"show_adult_content": True}
        )

    def _stored_ids(self, user=None, *, dismissed: bool = False) -> set[int]:
        return set(
            UserRecommendation.objects.filter(
                user=user or self.user, is_dismissed=dismissed
            ).values_list("anime_id", flat=True)
        )

    def _picks(self, limit: int = 20) -> list[dict]:
        return RecommendationService().content_recommender.get_recommendations_for_user(
            self.user, limit=limit
        )


class RecommendationServiceQualityTests(RecommendationFixtures, APITestCase):
    def test_recommender_excludes_placeholder_synopsis_candidates(self):
        anchor = self._anime("Anchor Favorite", genres=[self.genre_action])
        self._add_positive_list_entry(anchor, score=9)

        good = self._anime("Good Candidate", genres=[self.genre_action, self.genre_fantasy])
        placeholder = self._anime(
            "Placeholder Candidate",
            genres=[self.genre_action],
            synopsis=PLACEHOLDER_SYNOPSIS,
        )

        rec_ids = [row["anime"].id for row in self._picks()]

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

        by_id = {row["anime"].id: row for row in self._picks()}

        self.assertIn(high_quality_older.id, by_id)
        if weak_newer.id in by_id:
            self.assertGreater(by_id[high_quality_older.id]["score"], by_id[weak_newer.id]["score"])

    def test_recommender_biases_toward_dominant_user_format(self):
        anchor = self._anime(
            "TV Anchor", genres=[self.genre_fantasy], anime_type=Anime.AnimeType.tv
        )
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

        ordered_ids = [row["anime"].id for row in self._picks()]

        self.assertIn(tv_candidate.id, ordered_ids)
        if movie_candidate.id in ordered_ids:
            self.assertLess(
                ordered_ids.index(tv_candidate.id), ordered_ids.index(movie_candidate.id)
            )

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

        match = next((row for row in self._picks() if row["anime"].id == candidate.id), None)

        self.assertIsNotNone(match)
        self.assertEqual(match["reason"], UserRecommendation.RecommendationReason.BECAUSE_YOU_LIKED)
        self.assertEqual(match["metadata"].get("source_anime"), anchor.title)
        self.assertGreater(match["metadata"].get("confidence", 0), 0)

    def test_matched_genres_are_ordered_by_how_much_the_user_likes_them(self):
        loved = self._anime("Loved Fantasy", genres=[self.genre_fantasy])
        liked = self._anime("Liked Action Fantasy", genres=[self.genre_action, self.genre_fantasy])
        self._add_positive_list_entry(loved, score=10)
        self._add_positive_list_entry(liked, score=7)
        candidate = self._anime("Both Genres", genres=[self.genre_action, self.genre_fantasy])

        match = next(row for row in self._picks() if row["anime"].id == candidate.id)

        self.assertEqual(match["metadata"]["matched_genres"], ["Fantasy", "Action"])

    def test_filler_never_outranks_a_personal_match(self):
        anchor = self._anime("Filler Anchor", genres=[self.genre_action])
        self._add_positive_list_entry(anchor, score=9)
        self._anime("Personal Match", genres=[self.genre_action])
        for index in range(4):
            self._anime(
                f"Trending Unrelated {index}",
                anime_type=Anime.AnimeType.movie,
                trending_rank=index + 1,
                popularity_rank=index + 1,
                site_rank=index + 1,
                rating=9.5,
                member_count=2_000_000,
                studio=self.studio_b,
            )

        picks = self._picks(limit=6)
        personal = [row["score"] for row in picks if row["metadata"]]
        filler = [row["score"] for row in picks if not row["metadata"]]

        self.assertTrue(personal)
        self.assertTrue(filler)
        self.assertLess(max(filler), FILLER_SCORE_CEILING)
        self.assertLess(max(filler), min(personal))


class RecommendationIntegrityTests(RecommendationFixtures, APITestCase):
    """B3/B4: no adult titles for viewers who haven't opted in; dismissed stays dismissed."""

    def _seed_anchor(self) -> Anime:
        anchor = self._anime("Integrity Anchor", genres=[self.genre_action, self.genre_fantasy])
        self._add_positive_list_entry(anchor, score=9)
        return anchor

    def test_generation_for_non_opted_user_contains_no_adult_titles(self):
        self._seed_anchor()
        safe = self._anime("Safe Candidate", genres=[self.genre_action, self.genre_fantasy])
        adult = self._anime("Adult Candidate", genres=[self.genre_action, self.genre_fantasy])
        adult_filler = self._anime("Adult Filler", trending_rank=1, studio=self.studio_b)
        self._make_adult(adult)
        self._make_adult(adult_filler)

        RecommendationService().generate_for_user(self.user, limit=20)

        stored = self._stored_ids()
        self.assertIn(safe.id, stored)
        self.assertNotIn(adult.id, stored)
        self.assertNotIn(adult_filler.id, stored)
        self.assertFalse(
            UserRecommendation.objects.filter(user=self.user, anime__is_adult=True).exists()
        )

    def test_opted_in_user_can_get_adult_titles(self):
        self._allow_adult()
        self._seed_anchor()
        adult = self._anime("Adult Candidate", genres=[self.genre_action, self.genre_fantasy])
        self._make_adult(adult)

        RecommendationService().generate_for_user(self.user, limit=20)

        self.assertIn(adult.id, self._stored_ids())

    def test_read_path_hides_adult_rows_once_the_user_opts_out(self):
        safe = self._anime("Served Safe")
        adult = self._anime("Served Adult")
        self._make_adult(adult)
        for anime in (safe, adult):
            UserRecommendation.objects.create(
                user=self.user,
                anime=anime,
                score=80,
                reason=UserRecommendation.RecommendationReason.TOP_RATED,
            )
        service = RecommendationService()

        served = [rec.anime_id for rec in service.get_recommendations_for_user(self.user)]
        self.assertEqual(served, [safe.id])

        self._allow_adult()
        # can_view_adult_content caches the setting on the user object: reload it.
        self.user = User.objects.get(pk=self.user.pk)
        served = {rec.anime_id for rec in service.get_recommendations_for_user(self.user)}
        self.assertEqual(served, {safe.id, adult.id})

    def test_dismissed_title_stays_dismissed_after_regeneration(self):
        self._seed_anchor()
        candidate = self._anime("Dismiss Me", genres=[self.genre_action, self.genre_fantasy])
        service = RecommendationService()
        service.generate_for_user(self.user, limit=20)
        self.assertIn(candidate.id, self._stored_ids())

        self.assertTrue(service.dismiss_recommendation(self.user, candidate.id))
        service.generate_for_user(self.user, limit=20)

        self.assertIn(candidate.id, self._stored_ids(dismissed=True))
        self.assertNotIn(candidate.id, self._stored_ids())
        served = [rec.anime_id for rec in service.get_recommendations_for_user(self.user)]
        self.assertNotIn(candidate.id, served)

    def test_regeneration_replaces_only_non_dismissed_rows(self):
        self._seed_anchor()
        # Unrated, so no tier can pick it again.
        old = self._anime("Old Pick", genres=[self.genre_action], rating=None)
        dismissed = self._anime("Dismissed Pick", genres=[self.genre_action, self.genre_fantasy])
        UserRecommendation.objects.create(user=self.user, anime=old, score=70)
        UserRecommendation.objects.create(
            user=self.user, anime=dismissed, score=95, is_dismissed=True
        )

        RecommendationService().generate_for_user(self.user, limit=20)

        self.assertNotIn(old.id, self._stored_ids())
        row = UserRecommendation.objects.get(user=self.user, anime=dismissed)
        self.assertTrue(row.is_dismissed)
        self.assertEqual(row.score, 95)

    def test_reading_stale_rows_never_generates(self):
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
        with patch.object(service, "generate_for_user") as mock_generate:
            recs = service.get_recommendations_for_user(self.user, limit=10)

        self.assertEqual([rec.id for rec in recs], [stale_rec.id])
        mock_generate.assert_not_called()

    def test_dismissing_a_title_without_a_row_records_it(self):
        fallback_item = self._anime("Fallback Item", trending_rank=1)
        service = RecommendationService()

        self.assertTrue(service.dismiss_recommendation(self.user, fallback_item.id))
        self.assertIn(fallback_item.id, self._stored_ids(dismissed=True))
        self.assertFalse(service.dismiss_recommendation(self.user, 999_999))


class FranchiseAwareRecommendationTests(RecommendationFixtures, APITestCase):
    """P2-3: no sequels of unstarted shows, "Next in" for completed ones, 2 per franchise."""

    def setUp(self):
        super().setUp()
        self.genres = [self.genre_action, self.genre_fantasy]
        self.anchor = self._anime("Franchise Anchor", genres=self.genres)
        self._add_positive_list_entry(self.anchor, score=9)

    def _pick_ids(self) -> list[int]:
        return [row["anime"].id for row in self._picks(limit=20)]

    def test_sequel_of_an_unstarted_show_is_skipped(self):
        season_one = self._anime("Unstarted Season 1", genres=self.genres)
        season_two = self._anime("Unstarted Season 2", genres=self.genres)
        # Older rows store the title-case value; the comparison ignores case.
        self._prequel(season_two, season_one, relation_type="Prequel")

        ids = self._pick_ids()

        self.assertIn(season_one.id, ids)
        self.assertNotIn(season_two.id, ids)

    def test_sequel_of_a_watching_show_is_skipped(self):
        season_one = self._anime("Watching Season 1", genres=self.genres)
        UserAnimeList.objects.create(
            user=self.user, anime=season_one, status=UserAnimeList.UserAnimeStatus.watching
        )
        season_two = self._anime("Watching Season 2", genres=self.genres)
        self._prequel(season_two, season_one)

        self.assertNotIn(season_two.id, self._pick_ids())

    def test_sequel_of_a_completed_show_is_boosted_as_next_in(self):
        season_two = self._anime("Anchor Season 2", genres=self.genres, member_count=9_000)
        self._prequel(season_two, self.anchor)

        picks = self._picks(limit=20)
        match = next(row for row in picks if row["anime"].id == season_two.id)

        self.assertEqual(match["reason"], UserRecommendation.RecommendationReason.BECAUSE_YOU_LIKED)
        self.assertEqual(match["metadata"]["sequel_of"], self.anchor.title)
        self.assertEqual(match["metadata"]["source_anime"], self.anchor.title)
        self.assertEqual(picks[0]["anime"].id, season_two.id)

        RecommendationService().generate_for_user(self.user, limit=20)
        row = UserRecommendation.objects.get(user=self.user, anime=season_two)
        self.assertEqual(row.get_reason_display_text(), f"Next in {self.anchor.title}")

    def test_at_most_two_picks_per_franchise(self):
        follow_ups = [
            self._anime(f"Anchor Follow-up {index}", genres=self.genres) for index in range(4)
        ]
        for anime in follow_ups:
            self._prequel(anime, self.anchor)

        ids = self._pick_ids()

        self.assertEqual(len([anime for anime in follow_ups if anime.id in ids]), 2)
