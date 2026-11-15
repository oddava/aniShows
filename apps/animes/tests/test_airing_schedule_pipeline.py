from datetime import UTC, datetime, time, timedelta
from unittest.mock import MagicMock, Mock, patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from ..models import Anime
from ..services.anilist import AniListService
from ..services.public_anime_service import AnimeQueryService
from ..tasks.airing import AiringWorkflowTask


class AiringScheduleTestMixin:
    def setUp(self):
        super().setUp()
        self.enrich_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.watch_sync_patcher = patch(
            "apps.animes.signals.sync_watch_episodes_for_anime.apply_async"
        )
        self.enrich_patcher.start()
        self.watch_sync_patcher.start()
        self.addCleanup(self.enrich_patcher.stop)
        self.addCleanup(self.watch_sync_patcher.stop)

    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "Placeholder",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.airing,
            "member_count": 1000,
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)


def _airing_payload(anilist_id, title, **overrides):
    payload = {
        "id": anilist_id,
        "idMal": None,
        "title": {"romaji": title, "english": "", "native": ""},
        "format": "TV",
        "status": "RELEASING",
        "episodes": 12,
        "startDate": {"year": 2026, "month": 4, "day": 1},
        "endDate": None,
        "season": "SPRING",
        "seasonYear": 2026,
        "nextAiringEpisode": None,
    }
    payload.update(overrides)
    return payload


class AniListSchedulePersistenceTests(AiringScheduleTestMixin, TestCase):
    def _service(self):
        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(service.close)
        return service

    def test_update_airing_fields_derives_the_broadcast_slot_in_japan_time(self):
        anime = self._anime("Broadcast Test", status=Anime.AnimeStatus.unknown, anilist_id=999)
        # Sunday 2026-04-12 23:30 JST
        next_airing_at = int(datetime(2026, 4, 12, 14, 30, tzinfo=UTC).timestamp())
        item = _airing_payload(
            999, "Broadcast Test", nextAiringEpisode={"episode": 3, "airingAt": next_airing_at}
        )

        updated = self._service().update_airing_fields(anime, item)

        anime.refresh_from_db()
        self.assertTrue(updated)
        self.assertEqual(anime.status, Anime.AnimeStatus.airing)
        self.assertEqual(anime.broadcast_day, "Sunday")
        self.assertEqual(anime.broadcast_time, time(23, 30))
        self.assertEqual(anime.broadcast_timezone, "Asia/Tokyo")
        self.assertEqual(anime.next_airing_episode, 3)
        self.assertEqual(anime.next_airing_date, datetime.fromtimestamp(next_airing_at, tz=UTC))

    def test_update_airing_fields_keeps_fields_the_light_payload_lacks(self):
        anime = self._anime(
            "Light Payload",
            anilist_id=4242,
            synopsis="Stored synopsis",
            member_count=777,
            tags=["comedy"],
        )

        self._service().update_airing_fields(anime, _airing_payload(4242, "Light Payload"))

        anime.refresh_from_db()
        self.assertEqual(anime.synopsis, "Stored synopsis")
        self.assertEqual(anime.member_count, 777)
        self.assertEqual(anime.tags, ["comedy"])

    def test_update_airing_fields_rejects_a_payload_for_another_anilist_id(self):
        anime = self._anime("Identity", anilist_id=1, next_airing_episode=4)

        updated = self._service().update_airing_fields(
            anime, _airing_payload(2, "Identity", status="FINISHED")
        )

        anime.refresh_from_db()
        self.assertFalse(updated)
        self.assertEqual(anime.status, Anime.AnimeStatus.airing)
        self.assertEqual(anime.next_airing_episode, 4)

    def test_no_next_episode_clears_the_schedule_but_keeps_the_broadcast_slot(self):
        # AniList is authoritative: no nextAiringEpisode means nothing is scheduled.
        anime = self._anime(
            "Ended Run",
            anilist_id=12345,
            broadcast_day="Thursday",
            broadcast_time=time(22, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_episode=7,
            next_airing_date=timezone.now() + timedelta(days=3),
        )

        self._service().update_airing_fields(
            anime, _airing_payload(12345, "Ended Run", status="FINISHED")
        )

        anime.refresh_from_db()
        self.assertEqual(anime.status, Anime.AnimeStatus.finished)
        self.assertIsNone(anime.next_airing_episode)
        self.assertIsNone(anime.next_airing_date)
        self.assertEqual(anime.broadcast_day, "Thursday")
        self.assertEqual(anime.broadcast_time, time(22, 0))


class AiringWorkflowTaskTests(AiringScheduleTestMixin, TestCase):
    def _call_cache(self):
        call_cache = Mock()
        call_cache.is_recently_updated.return_value = False
        return call_cache

    def test_sync_airing_prefetches_once_and_applies_light_updates(self):
        mal_only = self._anime("MAL Backed", mal_id=5114, anilist_id=None)
        anilist = self._anime("AniList Backed", anilist_id=21)
        task = AiringWorkflowTask()
        service = MagicMock()
        service.resolve_airing_media_for_anime.return_value = {
            "nextAiringEpisode": {
                "episode": 2,
                "airingAt": int((timezone.now() + timedelta(days=1)).timestamp()),
            }
        }
        service.last_error_code = ""
        call_cache = self._call_cache()

        result = task._sync_airing(service, call_cache, None)

        service.prefetch_airing.assert_called_once()
        self.assertEqual(
            {anime.id for anime in service.prefetch_airing.call_args.args[0]},
            {mal_only.id, anilist.id},
        )
        self.assertEqual(service.update_airing_fields.call_count, 2)
        service.update_anime_manual.assert_not_called()
        self.assertEqual(
            {call.args[0] for call in call_cache.mark_updated.call_args_list},
            {mal_only.mal_id, anilist.anilist_id},
        )
        self.assertEqual(result["updated"], 2)
        self.assertEqual(result["errors"], 0)

    def test_sync_airing_costs_one_request_for_the_whole_batch(self):
        for anilist_id in (101, 102, 103):
            self._anime(f"Show {anilist_id}", anilist_id=anilist_id)
        next_at = int((timezone.now() + timedelta(days=1)).timestamp())
        queries = []

        def fake_query(service, query, variables, *args, **kwargs):
            queries.append(variables)
            return {
                "Page": {
                    "media": [
                        _airing_payload(
                            anilist_id,
                            f"Show {anilist_id}",
                            nextAiringEpisode={"episode": 5, "airingAt": next_at},
                        )
                        for anilist_id in variables["ids"]
                    ]
                }
            }

        service = AniListService(enable_caching=False, enable_rate_limiting=False)
        self.addCleanup(service.close)
        with patch.object(AniListService, "_query", fake_query):
            result = AiringWorkflowTask()._sync_airing(service, self._call_cache(), None)

        self.assertEqual(len(queries), 1)
        self.assertEqual(sorted(queries[0]["ids"]), [101, 102, 103])
        self.assertEqual(result["updated"], 3)
        self.assertEqual(result["missing_dates"], 0)
        self.assertEqual(set(Anime.objects.values_list("next_airing_episode", flat=True)), {5})

    def test_backfill_counts_rows_still_missing_a_date(self):
        anime = self._anime("No Date", anilist_id=7)
        service = MagicMock()
        service.resolve_airing_media_for_anime.return_value = {"nextAiringEpisode": None}
        service.last_error_code = ""

        result = AiringWorkflowTask()._backfill_missing(service, self._call_cache(), None)

        service.prefetch_airing.assert_called_once()
        service.update_airing_fields.assert_called_once_with(
            anime, service.resolve_airing_media_for_anime.return_value
        )
        self.assertEqual(result["still_missing"], 1)
        self.assertEqual(result["populated"], 0)

    def test_rate_limited_lookups_are_counted(self):
        self._anime("Throttled", anilist_id=8)
        service = MagicMock()
        service.resolve_airing_media_for_anime.return_value = None
        service.last_error_code = "rate_limited"

        result = AiringWorkflowTask()._sync_airing(service, self._call_cache(), None)

        self.assertEqual(result["rate_limited"], 1)
        self.assertEqual(result["updated"], 0)


class ScheduleEndpointTests(AiringScheduleTestMixin, APITestCase):
    def test_schedule_endpoint_groups_currently_airing_anime_by_broadcast_day(self):
        monday = self._anime(
            "Monday Show",
            broadcast_day="Monday",
            broadcast_time=time(10, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=timezone.now() + timedelta(hours=8),
            next_airing_episode=4,
        )
        self._anime(
            "Tuesday Show",
            broadcast_day="Tuesday",
            broadcast_time=time(11, 0),
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=timezone.now() + timedelta(days=1),
            next_airing_episode=7,
        )
        self._anime(
            "Finished Show",
            status=Anime.AnimeStatus.finished,
            broadcast_day="Monday",
            next_airing_date=timezone.now() + timedelta(days=2),
        )

        response = self.client.get("/api/v1/anime/schedule/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["counts"]["monday"], 1)
        self.assertEqual(response.data["counts"]["tuesday"], 1)
        self.assertEqual(response.data["total"], 2)
        self.assertEqual(response.data["days"]["monday"][0]["title"], monday.title)
        self.assertEqual(response.data["days"]["monday"][0]["broadcast_day"], "Monday")
        self.assertEqual(response.data["days"]["monday"][0]["broadcast_timezone"], "Asia/Tokyo")

    def test_schedule_endpoint_rejects_invalid_day_filters(self):
        response = self.client.get("/api/v1/anime/schedule/?day=invalid")

        self.assertEqual(response.status_code, 400)

    def test_resolve_schedule_day_uses_broadcast_timezone_for_next_airing_fallback(self):
        anime = self._anime(
            "Timezone Fallback",
            broadcast_day="",
            broadcast_timezone="Asia/Tokyo",
            next_airing_date=datetime(2026, 4, 11, 15, 30, tzinfo=UTC),
        )

        self.assertEqual(AnimeQueryService.resolve_schedule_day(anime), "Sunday")
