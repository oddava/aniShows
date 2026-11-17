from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

from django.test import SimpleTestCase

from ..tasks.sync import SyncAnimeCatalogTask


class SyncAnimeCatalogTaskTests(SimpleTestCase):
    def test_trending_sync_rejects_implausibly_small_result_set(self):
        task = SyncAnimeCatalogTask()

        fake_service = SimpleNamespace(
            get_recent_updates=MagicMock(
                return_value=[
                    {"id": 1, "title": {"romaji": "Only One"}},
                    {"id": 2, "title": {"romaji": "Only Two"}},
                ]
            ),
            close=MagicMock(),
        )

        with (
            patch.object(
                type(task),
                "request",
                new_callable=PropertyMock,
                return_value=SimpleNamespace(id=None),
            ),
            patch("apps.animes.tasks.sync.AniListService", return_value=fake_service),
            patch.object(task, "_sync_trending_anime_rows", new=MagicMock()) as sync_rows,
            patch(
                "apps.animes.tasks.sync.CatalogSyncService.refresh_trending_ranks"
            ) as refresh_ranks,
        ):
            result = task._run_sync("trending", 50, {"update_ranks": True})

        self.assertEqual(result["status"], "source_unhealthy")
        self.assertEqual(result["fetched"], 2)
        self.assertEqual(result["minimum_expected"], 6)
        self.assertEqual(result["reason"], "provider_result_set_too_small")
        sync_rows.assert_not_called()
        refresh_ranks.assert_not_called()
        fake_service.close.assert_called_once()

    def test_minimum_trending_results_caps_at_threshold(self):
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(0), 0)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(3), 3)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(50), 6)

    def test_trending_rows_are_keyed_by_anilist_id_in_rank_order(self):
        saved = []

        def save(item):
            saved.append(item["id"])
            return SimpleNamespace(id=item["id"] * 10)

        service = SimpleNamespace(save_anime_to_db=save)
        items = [
            {"id": 3},
            {"idMal": 99},  # no AniList ID: skipped
            {"id": 1},
            {"id": 3},  # repeat: saved again (fresh data) but ranked once
            "junk",
        ]

        ranked = SyncAnimeCatalogTask()._sync_trending_anime_rows(service, items)

        self.assertEqual(saved, [3, 1, 3])
        self.assertEqual(ranked, [30, 10])

    def test_trending_sync_fetches_from_anilist_and_ranks(self):
        task = SyncAnimeCatalogTask()
        items = [{"id": n} for n in range(1, 7)]
        fake_service = SimpleNamespace(
            get_recent_updates=MagicMock(return_value=items), close=MagicMock()
        )

        with (
            patch.object(
                type(task),
                "request",
                new_callable=PropertyMock,
                return_value=SimpleNamespace(id=None),
            ),
            patch("apps.animes.tasks.sync.AniListService", return_value=fake_service),
            patch.object(
                task, "_sync_trending_anime_rows", new=MagicMock(return_value=[11, 12])
            ) as sync_rows,
            patch(
                "apps.animes.tasks.sync.CatalogSyncService.refresh_trending_ranks",
                return_value=2,
            ) as refresh_ranks,
        ):
            result = task._run_sync("trending", 6, {"update_ranks": True})

        fake_service.get_recent_updates.assert_called_once_with(limit=6)
        sync_rows.assert_called_once_with(fake_service, items)
        refresh_ranks.assert_called_once_with([11, 12])
        self.assertEqual(result["status"], "success")
        self.assertEqual(task.metrics.api_calls, {"anilist": 6})
