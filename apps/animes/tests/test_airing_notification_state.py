from datetime import timedelta

from asgiref.sync import async_to_sync
from django.test import TestCase
from django.utils import timezone

from ..models import Anime
from ..services.anilist import AniListService


class AiringNotificationStateTests(TestCase):
    def setUp(self):
        self.service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(async_to_sync(self.service.close))

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
