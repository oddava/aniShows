from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, PropertyMock, patch

from ..tasks.sync import SyncAnimeCatalogTask


class SyncAnimeCatalogTaskTests(IsolatedAsyncioTestCase):
    async def test_trending_sync_rejects_implausibly_small_jikan_result_set(self):
        task = SyncAnimeCatalogTask()

        fake_service = SimpleNamespace(
            get_recent_updates=AsyncMock(
                return_value=[
                    {"idMal": 1, "title": {"romaji": "Only One"}},
                    {"idMal": 2, "title": {"romaji": "Only Two"}},
                ]
            ),
            close=AsyncMock(),
        )

        with (
            patch.object(type(task), "request", new_callable=PropertyMock, return_value=SimpleNamespace(id=None)),
            patch("apps.animes.tasks.sync.JikanService", return_value=fake_service),
            patch.object(task, "_sync_trending_anime_rows", new=AsyncMock()) as sync_rows,
            patch("apps.animes.tasks.sync.CatalogSyncService.refresh_trending_ranks") as refresh_ranks,
        ):
            result = await task._async_sync("trending", 50, {"update_ranks": True})

        self.assertEqual(result["status"], "source_unhealthy")
        self.assertEqual(result["fetched"], 2)
        self.assertEqual(result["minimum_expected"], 6)
        sync_rows.assert_not_awaited()
        refresh_ranks.assert_not_called()
        fake_service.close.assert_awaited_once()

    def test_minimum_trending_results_caps_at_threshold(self):
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(0), 0)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(3), 3)
        self.assertEqual(SyncAnimeCatalogTask._minimum_trending_results(50), 6)
