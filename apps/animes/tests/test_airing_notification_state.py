from datetime import timedelta
from typing import cast

from django.test import TestCase
from django.utils import timezone

from ..models import Anime
from ..services.anilist import AniListService
from ..tasks.airing import AiringWorkflowTask, record_aired_episode, record_aired_episodes


class AiringNotificationStateTests(TestCase):
    def setUp(self):
        self.service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(self.service.close)

    def _create_anime(self, **overrides):
        data = {
            "title": overrides.pop("title", "Tracked Anime"),
            "slug": overrides.pop("slug", "tracked-anime"),
            "synopsis": overrides.pop("synopsis", "Synopsis"),
            "status": overrides.pop("status", Anime.AnimeStatus.airing),
        }
        data.update(overrides)
        return Anime.objects.create(**data)

    def test_records_last_aired_episode_when_schedule_advances(self):
        previous_airing_date = timezone.now() - timedelta(hours=1)
        anime = self._create_anime(
            next_airing_episode=6,
            next_airing_date=previous_airing_date,
        )
        anime_data = {
            "next_airing_episode": 7,
            "next_airing_date": timezone.now() + timedelta(days=7),
        }

        self.service._apply_recent_airing_transition(anime, anime_data)

        self.assertEqual(anime_data["last_aired_episode"], 6)
        self.assertEqual(anime_data["last_aired_at"], previous_airing_date)

    def test_records_last_aired_episode_when_show_finishes_after_airing(self):
        previous_airing_date = timezone.now() - timedelta(hours=2)
        anime = self._create_anime(
            next_airing_episode=12,
            next_airing_date=previous_airing_date,
        )
        anime_data = {
            "status": Anime.AnimeStatus.finished,
            "next_airing_episode": None,
            "next_airing_date": None,
        }

        self.service._apply_recent_airing_transition(anime, anime_data)

        self.assertEqual(anime_data["last_aired_episode"], 12)
        self.assertEqual(anime_data["last_aired_at"], previous_airing_date)

    def test_does_not_record_last_aired_episode_before_airing_time(self):
        anime = self._create_anime(
            next_airing_episode=4,
            next_airing_date=timezone.now() + timedelta(hours=2),
        )
        anime_data = {
            "next_airing_episode": 5,
            "next_airing_date": timezone.now() + timedelta(days=7),
        }

        self.service._apply_recent_airing_transition(anime, anime_data)

        self.assertNotIn("last_aired_episode", anime_data)
        self.assertNotIn("last_aired_at", anime_data)


class CleanupRecordsAiredEpisodeTests(TestCase):
    """C-INT-5: clearing a past schedule first records the episode that aired."""

    def _anime(self, slug, **fields):
        return Anime.objects.create(title=slug, slug=slug, synopsis="s", **fields)

    def test_one_row_moves_forward_only(self):
        aired = timezone.now() - timedelta(hours=1)
        anime = self._anime("a", next_airing_episode=6, next_airing_date=aired)
        self.assertEqual(record_aired_episode(anime), ["last_aired_episode", "last_aired_at"])
        self.assertEqual((anime.last_aired_episode, anime.last_aired_at), (6, aired))

        already = self._anime(
            "b", next_airing_episode=6, next_airing_date=aired, last_aired_episode=6
        )
        future = self._anime(
            "c", next_airing_episode=7, next_airing_date=timezone.now() + timedelta(hours=1)
        )
        self.assertEqual(record_aired_episode(already), [])
        self.assertEqual(record_aired_episode(future), [])

    def test_batch_update_matches_the_single_row_rule(self):
        aired = timezone.now() - timedelta(hours=1)
        due = self._anime(
            "due", next_airing_episode=3, next_airing_date=aired, last_aired_episode=2
        )
        later = self._anime(
            "later", next_airing_episode=4, next_airing_date=timezone.now() + timedelta(days=1)
        )
        newer = self._anime(
            "newer", next_airing_episode=3, next_airing_date=aired, last_aired_episode=5
        )

        self.assertEqual(record_aired_episodes(Anime.objects.all()), 1)
        due.refresh_from_db()
        later.refresh_from_db()
        newer.refresh_from_db()
        self.assertEqual((due.last_aired_episode, due.last_aired_at), (3, aired))
        self.assertIsNone(later.last_aired_episode)
        self.assertEqual(newer.last_aired_episode, 5)

    def _cleanup(self, payload):
        class FakeService:
            def prefetch_airing(self, animes):
                return 0

            def resolve_airing_media_for_anime(self, anime):
                return payload

        service = cast("AniListService", FakeService())
        return AiringWorkflowTask()._cleanup_finished(service, batch_size=None)

    def test_cleanup_records_before_clearing_in_both_branches(self):
        for status in ("FINISHED", "RELEASING"):
            with self.subTest(status=status):
                Anime.objects.all().delete()
                aired = timezone.now() - timedelta(hours=2)
                anime = self._anime(
                    f"show-{status.lower()}",
                    status=Anime.AnimeStatus.airing,
                    next_airing_episode=9,
                    next_airing_date=aired,
                    last_aired_episode=8,
                )
                self._cleanup({"status": status})
                anime.refresh_from_db()
                self.assertIsNone(anime.next_airing_episode)
                self.assertEqual((anime.last_aired_episode, anime.last_aired_at), (9, aired))

    def test_batch_clear_of_finished_rows_records_too(self):
        aired = timezone.now() - timedelta(hours=3)
        anime = self._anime(
            "finished-show",
            status=Anime.AnimeStatus.finished,
            next_airing_episode=12,
            next_airing_date=aired,
        )
        # The per-row phase got no payload for it (rate-limited): only the batch clear runs.
        self._cleanup(None)
        anime.refresh_from_db()
        self.assertIsNone(anime.next_airing_date)
        self.assertEqual((anime.last_aired_episode, anime.last_aired_at), (12, aired))
