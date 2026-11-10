from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

from django.test import SimpleTestCase

from ..tasks.sync import SyncAnimeCatalogTask


class SyncAnimeCatalogTaskTests(SimpleTestCase):
    def test_trending_sync_rejects_implausibly_small_jikan_result_set(self):
        task = SyncAnimeCatalogTask()

        fake_service = SimpleNamespace(
            get_recent_updates=MagicMock(
                return_value=[
                    {"idMal": 1, "title": {"romaji": "Only One"}},
                    {"idMal": 2, "title": {"romaji": "Only Two"}},
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
            patch("apps.animes.tasks.sync.JikanService", return_value=fake_service),
            patch.object(task, "_sync_trending_anime_rows", new=MagicMock()) as sync_rows,
            patch(
                "apps.animes.tasks.sync.CatalogSyncService.refresh_trending_ranks"
            ) as refresh_ranks,
        ):
            result = task._run_sync("trending", 50, {"update_ranks": True})

        self.assertEqual(result["status"], "source_unhealthy")
        self.assertEqual(result["fetched"], 2)
        self.assertEqual(result["minimum_expected"], 6)
        sync_rows.assert_not_called()
        refresh_ranks.assert_not_called()
        fake_service.close.assert_called_once()

    def test_minimum_trending_results_caps_at_threshold(self):
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(0), 0)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(3), 3)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(50), 6)
