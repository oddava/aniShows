import io
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import httpx
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from ..models import Anime
from ..services.watch_episodes import AnimeWatchEpisodeService
from ..tasks.watch_episodes import WatchEpisodeBatchSyncTask, WatchEpisodeSyncTask

SCHEDULE_PATH = "apps.animes.services.watch_episodes.AniListService.get_episode_schedule"


def _ts(year, month, day, hour=0, minute=0):
    return int(datetime(year, month, day, hour, minute, tzinfo=UTC).timestamp())


class AnimeWatchEpisodeServiceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.anime = Anime.objects.create(
            title="Frieren",
            slug="frieren",
            synopsis="Elf mage.",
            anime_type="TV",
            status="Finished",
            mal_id=52991,
            anilist_id=154587,
        )
        self.service = AnimeWatchEpisodeService()

    def _schedule(self, **overrides):
        payload = {
            "id": self.anime.anilist_id,
            "idMal": self.anime.mal_id,
            "episodes": 2,
            "status": "FINISHED",
            "nextAiringEpisode": None,
            "streamingEpisodes": [],
            "airingSchedule": [],
        }
        payload.update(overrides)
        return payload

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_nothing_aired_yet_lists_no_episodes(self, mock_schedule):
        # The stored total (12 planned episodes) must not be listed as watchable.
        self.anime.episode_count = 12
        self.anime.save(update_fields=["episode_count"])
        for payload in (
            self._schedule(status="NOT_YET_RELEASED", episodes=12),
            self._schedule(
                status="RELEASING",
                episodes=12,
                nextAiringEpisode={"episode": 1, "airingAt": _ts(2026, 12, 1)},
            ),
        ):
            cache.clear()
            mock_schedule.return_value = payload
            self.assertEqual(self.service.get_for_anime(self.anime), [])

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_unknown_episode_data_falls_back_to_the_stored_total(self, mock_schedule):
        self.anime.episode_count = 3
        self.anime.save(update_fields=["episode_count"])
        mock_schedule.return_value = self._schedule(status="FINISHED", episodes=None)

        episodes = self.service.get_for_anime(self.anime)

        self.assertEqual([episode["number"] for episode in episodes], [1, 2, 3])

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_builds_episodes_from_the_anilist_schedule_and_streams(self, mock_schedule):
        mock_schedule.return_value = self._schedule(
            streamingEpisodes=[
                {
                    "title": "Episode 1 - The Journey Begins",
                    "thumbnail": "https://img.anilist.co/episode-1.jpg",
                    "url": "https://www.crunchyroll.com/watch/G62PE001",
                    "site": "Crunchyroll",
                },
                {
                    "title": "Episode 2 - Other Service",
                    "thumbnail": "https://img.anilist.co/episode-2.jpg",
                    "url": "https://www.netflix.com/watch/123",
                    "site": "Netflix",
                },
            ],
            airingSchedule=[
                # 15:00 UTC is midnight in Japan: the broadcast date is the next day.
                {"episode": 1, "airingAt": _ts(2024, 1, 12, 15, 0)},
                {"episode": 2, "airingAt": _ts(2024, 1, 19, 14, 0)},
            ],
        )

        episodes = self.service.get_for_anime(self.anime)

        mock_schedule.assert_called_once_with(
            anilist_id=154587, mal_id=52991, request_budget="default"
        )
        self.assertEqual(len(episodes), 2)
        self.assertEqual(episodes[0]["number"], 1)
        self.assertEqual(episodes[0]["title"], "The Journey Begins")
        self.assertEqual(episodes[0]["aired"], "2024-01-13")
        self.assertEqual(episodes[0]["thumbnail"], "https://img.anilist.co/episode-1.jpg")
        self.assertEqual(
            episodes[0]["crunchyroll_url"],
            "https://www.crunchyroll.com/watch/G62PE001",
        )
        self.assertTrue(episodes[0]["has_real_crunchyroll_url"])

        self.assertEqual(episodes[1]["number"], 2)
        self.assertEqual(episodes[1]["title"], "Episode 2")
        self.assertEqual(episodes[1]["aired"], "2024-01-19")
        self.assertEqual(
            episodes[1]["crunchyroll_url"],
            "https://www.crunchyroll.com/search?q=Frieren+episode+2",
        )
        self.assertFalse(episodes[1]["has_real_crunchyroll_url"])

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_airing_show_lists_only_released_episodes(self, mock_schedule):
        mock_schedule.return_value = self._schedule(
            status="RELEASING",
            episodes=24,
            nextAiringEpisode={"episode": 4, "airingAt": _ts(2030, 1, 1)},
            airingSchedule=[{"episode": n, "airingAt": _ts(2024, 1, n)} for n in (1, 2, 3)],
        )

        episodes = self.service.get_for_anime(self.anime)

        self.assertEqual([episode["number"] for episode in episodes], [1, 2, 3])

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_finished_show_uses_the_episode_total_when_the_schedule_is_partial(self, mock_schedule):
        mock_schedule.return_value = self._schedule(
            episodes=4, airingSchedule=[{"episode": 3, "airingAt": _ts(2020, 5, 1)}]
        )

        episodes = self.service.get_for_anime(self.anime)

        self.assertEqual([episode["number"] for episode in episodes], [1, 2, 3, 4])
        self.assertEqual(
            [episode["aired"] for episode in episodes], [None, None, "2020-05-01", None]
        )

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_streaming_title_prefixes_are_stripped(self, mock_schedule):
        def stream(title):
            return {
                "title": title,
                "url": "https://www.crunchyroll.com/watch/x",
                "site": "Crunchyroll",
            }

        mock_schedule.return_value = self._schedule(
            episodes=3,
            streamingEpisodes=[
                stream("Episode 1 - Alpha"),
                stream("Ep. 2: Beta"),
                stream("Episode 3"),
            ],
        )

        titles = [episode["title"] for episode in self.service.get_for_anime(self.anime)]

        self.assertEqual(titles, ["Alpha", "Beta", "Episode 3"])

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_caches_the_episode_payload(self, mock_schedule):
        mock_schedule.return_value = self._schedule(episodes=1)

        first = self.service.get_for_anime(self.anime)
        second = self.service.get_for_anime(self.anime)

        self.assertEqual(first, second)
        mock_schedule.assert_called_once()

    def test_falls_back_to_generic_episode_list_when_external_episode_data_is_missing(self):
        anime = Anime.objects.create(
            title="Fallback Show",
            slug="fallback-show",
            synopsis="Fallback episodes.",
            anime_type="TV",
            status="Finished",
            episode_count=3,
        )

        episodes = self.service.get_for_anime(anime)

        self.assertEqual(
            episodes,
            [
                {
                    "number": 1,
                    "title": "Episode 1",
                    "aired": "",
                    "thumbnail": "",
                    "crunchyroll_url": "https://www.crunchyroll.com/search?q=Fallback+Show+episode+1",
                    "has_real_crunchyroll_url": False,
                },
                {
                    "number": 2,
                    "title": "Episode 2",
                    "aired": "",
                    "thumbnail": "",
                    "crunchyroll_url": "https://www.crunchyroll.com/search?q=Fallback+Show+episode+2",
                    "has_real_crunchyroll_url": False,
                },
                {
                    "number": 3,
                    "title": "Episode 3",
                    "aired": "",
                    "thumbnail": "",
                    "crunchyroll_url": "https://www.crunchyroll.com/search?q=Fallback+Show+episode+3",
                    "has_real_crunchyroll_url": False,
                },
            ],
        )

    @patch(SCHEDULE_PATH, new_callable=MagicMock)
    def test_falls_back_when_anilist_has_nothing(self, mock_schedule):
        anime = Anime.objects.create(
            title="Unknown To AniList",
            slug="unknown-to-anilist",
            synopsis="x",
            anime_type="TV",
            status="Finished",
            anilist_id=777777,
            episode_count=2,
        )
        mock_schedule.return_value = None

        episodes = self.service.get_for_anime(anime)

        self.assertEqual([episode["number"] for episode in episodes], [1, 2])
        self.assertFalse(any(episode["has_real_crunchyroll_url"] for episode in episodes))

    def test_interactive_budget_falls_back_quickly_when_anilist_times_out(self):
        anime = Anime.objects.create(
            title="Fallback With Timeout",
            slug="fallback-with-timeout",
            synopsis="Timeout fallback.",
            anime_type="TV",
            status="Finished",
            mal_id=53000,
            anilist_id=154600,
            episode_count=3,
        )
        calls = []

        def timeout(request):
            calls.append(request)
            raise httpx.ReadTimeout("timed out", request=request)

        transport = httpx.MockTransport(timeout)
        with patch.object(
            httpx.HTTPTransport,
            "handle_request",
            lambda _self, request: transport.handle_request(request),
        ):
            episodes = self.service.get_for_anime(anime, request_budget="interactive")

        self.assertEqual([episode["number"] for episode in episodes], [1, 2, 3])
        self.assertTrue(all(not episode["has_real_crunchyroll_url"] for episode in episodes))
        # The interactive budget makes one try, no retries.
        self.assertEqual(len(calls), 1)


class AnimeWatchEpisodesEndpointTests(APITestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.views.anime.AnimeWatchEpisodeService.get_for_anime")
    def test_watch_episodes_endpoint_returns_paginated_results(
        self, mock_get_for_anime, _mock_delay
    ):
        anime = Anime.objects.create(
            title="Delicious in Dungeon",
            slug="delicious-in-dungeon",
            synopsis="Cooking in a dungeon.",
            anime_type="TV",
            status="Finished",
        )
        mock_get_for_anime.return_value = [
            {
                "number": index,
                "title": f"Episode {index}",
                "aired": "2024-01-04",
                "thumbnail": "https://img.anilist.co/dungeon-meshi-1.jpg",
                "crunchyroll_url": "https://www.crunchyroll.com/watch/GEXAMPLE",
                "has_real_crunchyroll_url": True,
            }
            for index in range(1, 55)
        ]

        response = self.client.get(
            reverse("anime-watch-episodes", args=[anime.slug]),
            {"page": 2, "page_size": 20},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 54)
        self.assertEqual(len(response.data["results"]), 20)
        self.assertEqual(response.data["results"][0]["number"], 21)
        self.assertEqual(response.data["results"][0]["title"], "Episode 21")
        self.assertIsNone(response.data["results"][0]["average_rating"])
        self.assertEqual(response.data["results"][0]["rating_count"], 0)
        self.assertIsNone(response.data["results"][0]["user_rating"])

    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.views.anime.EpisodeRatingSummaryService.get_for_anime")
    @patch("apps.animes.views.anime.AnimeWatchEpisodeService.get_for_anime")
    def test_watch_episodes_endpoint_only_loads_ratings_for_current_page(
        self,
        mock_get_for_anime,
        mock_get_episode_ratings,
        _mock_delay,
    ):
        anime = Anime.objects.create(
            title="Long Runner",
            slug="long-runner",
            synopsis="Very long show.",
            anime_type="TV",
            status="Finished",
        )
        mock_get_for_anime.return_value = [
            {
                "number": index,
                "title": f"Episode {index}",
                "aired": "2024-01-04",
                "thumbnail": "",
                "crunchyroll_url": "https://www.crunchyroll.com/watch/GEXAMPLE",
                "has_real_crunchyroll_url": True,
            }
            for index in range(1, 121)
        ]
        mock_get_episode_ratings.return_value = []

        response = self.client.get(
            reverse("anime-watch-episodes", args=[anime.slug]),
            {"page": 3, "page_size": 25},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 25)
        self.assertEqual(response.data["results"][0]["number"], 51)
        self.assertEqual(response.data["results"][-1]["number"], 75)
        self.assertEqual(mock_get_episode_ratings.call_count, 1)
        call_args = mock_get_episode_ratings.call_args
        self.assertEqual(call_args.args[0].id, anime.id)
        self.assertEqual(call_args.kwargs["episode_numbers"], list(range(51, 76)))


class AnimeWatchEpisodeTaskTests(TestCase):
    def setUp(self):
        self.anime = Anime.objects.create(
            title="Orb: On the Movements of the Earth",
            slug="orb-on-the-movements-of-the-earth",
            synopsis="Astronomy and danger.",
            anime_type="TV",
            status="Airing",
            mal_id=60001,
            anilist_id=160001,
        )

    @patch("apps.animes.tasks.watch_episodes.AnimeWatchEpisodeService.get_for_anime")
    @patch("apps.animes.tasks.watch_episodes.AnimeWatchEpisodeService.invalidate_for_anime")
    def test_single_task_warms_one_anime(self, mock_invalidate, mock_get_for_anime):
        mock_get_for_anime.return_value = [{"number": 1, "title": "Episode 1"}]

        result = WatchEpisodeSyncTask().execute(anime_id=self.anime.id, force=True)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["episodes"], 1)
        mock_invalidate.assert_called_once()
        mock_get_for_anime.assert_called_once()

    @patch("apps.animes.tasks.watch_episodes.AnimeWatchEpisodeService.get_for_anime")
    def test_batch_task_filters_by_status(self, mock_get_for_anime):
        finished = Anime.objects.create(
            title="Erased",
            slug="erased",
            synopsis="Mystery.",
            anime_type="TV",
            status="Finished",
            mal_id=60002,
            anilist_id=160002,
        )
        mock_get_for_anime.return_value = [{"number": 1, "title": "Episode 1"}]

        result = WatchEpisodeBatchSyncTask().execute(statuses=["Airing"])

        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["warmed"], 1)
        self.assertEqual(
            [call.args[0].id for call in mock_get_for_anime.call_args_list],
            [self.anime.id],
        )
        self.assertNotIn(finished.id, result["anime_ids"])


@override_settings(
    ANIME_WATCH_EPISODE_AUTO_SYNC_ENABLED=True,
    ANIME_METADATA_AUTO_ENRICH_ENABLED=True,
)
class AnimeWatchEpisodeSignalTests(TestCase):
    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.signals.sync_watch_episodes_for_anime.apply_async")
    def test_create_enqueues_watch_episode_sync_after_commit(
        self, mock_apply_async, mock_enrich_delay
    ):
        with self.captureOnCommitCallbacks(execute=True):
            anime = Anime.objects.create(
                title="Dandadan",
                slug="dandadan",
                synopsis="Aliens and ghosts.",
                anime_type="TV",
                status="Airing",
                mal_id=61001,
                anilist_id=161001,
            )

        mock_enrich_delay.assert_called_once_with(anime_id=anime.id, mode="single")
        mock_apply_async.assert_called_once_with(kwargs={"anime_id": anime.id, "force": False})

    @patch("apps.animes.signals.enrich_metadata.delay")
    @patch("apps.animes.signals.AnimeWatchEpisodeService.invalidate_for_anime_version")
    @patch("apps.animes.signals.sync_watch_episodes_for_anime.apply_async")
    def test_identity_change_invalidates_old_cache_and_requeues(
        self,
        mock_apply_async,
        mock_invalidate,
        _mock_enrich_delay,
    ):
        anime = Anime.objects.create(
            title="Lazarus",
            slug="lazarus",
            synopsis="Future thriller.",
            anime_type="TV",
            status="Airing",
            mal_id=62001,
            anilist_id=162001,
        )
        mock_apply_async.reset_mock()

        with self.captureOnCommitCallbacks(execute=True):
            anime.mal_id = 62002
            anime.save(update_fields=["mal_id"])

        mock_invalidate.assert_called_once()
        self.assertEqual(mock_invalidate.call_args.args[0], anime.id)
        mock_apply_async.assert_called_once_with(kwargs={"anime_id": anime.id, "force": True})


class WarmWatchEpisodesCommandTests(TestCase):
    @patch("apps.animes.management.commands.warm_watch_episodes.sync_watch_episodes_batch.s")
    def test_async_command_queues_batch_task(self, mock_signature):
        anime = Anime.objects.create(
            title="Blue Box",
            slug="blue-box",
            synopsis="Sports and romance.",
            anime_type="TV",
            status="Airing",
            mal_id=63001,
            anilist_id=163001,
        )
        mock_task = Mock()
        mock_task.apply_async.return_value = SimpleNamespace(id="watch-task-1")
        mock_signature.return_value = mock_task
        stdout = io.StringIO()

        call_command("warm_watch_episodes", "--async", stdout=stdout)

        mock_signature.assert_called_once_with(anime_ids=[anime.id], force=False)
        mock_task.apply_async.assert_called_once_with()
        self.assertIn("Queued watch-episode warm for 1 anime", stdout.getvalue())
