import io
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import Mock, patch

try:
    import zstandard
except ModuleNotFoundError:  # pragma: no cover - depends on runtime image
    zstandard = None
from django.core.management import call_command
from django.test import TestCase

from apps.animes.models import Anime, OfflineAnimeSyncState, OfflineCatalogImport
from apps.animes.tasks.offline_catalog import (
    OfflineCatalogImportTask,
    OfflineCatalogReconcileSyncTask,
)


class OfflineCatalogTaskAndCommandTests(TestCase):
    def setUp(self):
        self.enrich_signal_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.enrich_signal_patcher.start()
        self.addCleanup(self.enrich_signal_patcher.stop)

    def _entry(self, *, title: str, anilist_id: int, mal_id: int) -> dict:
        return {
            "sources": [
                f"https://anilist.co/anime/{anilist_id}",
                f"https://myanimelist.net/anime/{mal_id}",
            ],
            "title": title,
            "type": "TV",
            "episodes": 12,
            "status": "FINISHED",
            "animeSeason": {"season": "SPRING", "year": 2020},
            "picture": f"https://cdn.example.com/{anilist_id}.jpg",
            "thumbnail": f"https://cdn.example.com/{anilist_id}-thumb.jpg",
            "duration": {"value": 1440, "unit": "SECONDS"},
            "score": {"arithmeticGeometricMean": 7.7},
            "synonyms": [f"{title} Alt"],
            "studios": ["Bones"],
            "producers": ["Aniplex"],
            "tags": ["action"],
        }

    def _write_jsonl_fixture(self, entries: list[dict], last_update: str = "2026-03-23") -> str:
        metadata = {"$schema": "https://example.com/schema.json", "lastUpdate": last_update}
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as handle:
            fixture_path = handle.name
            self.addCleanup(lambda: Path(fixture_path).unlink(missing_ok=True))
            handle.write(json.dumps(metadata) + "\n")
            for entry in entries:
                handle.write(json.dumps(entry) + "\n")
        return fixture_path

    def _write_zst_fixture(self, entries: list[dict], last_update: str = "2026-03-23") -> str:
        if zstandard is None:
            self.skipTest("zstandard not available in runtime")
        metadata = {"$schema": "https://example.com/schema.json", "lastUpdate": last_update}
        payload_lines = [json.dumps(metadata), *[json.dumps(entry) for entry in entries]]
        payload = ("\n".join(payload_lines) + "\n").encode("utf-8")

        compressor = zstandard.ZstdCompressor()
        with tempfile.NamedTemporaryFile("wb", suffix=".jsonl.zst", delete=False) as handle:
            fixture_path = handle.name
            self.addCleanup(lambda: Path(fixture_path).unlink(missing_ok=True))
            handle.write(compressor.compress(payload))
        return fixture_path

    def test_task_execute_imports_from_jsonl_source(self):
        source_path = self._write_jsonl_fixture(
            [self._entry(title="Task Import Alpha", anilist_id=1001, mal_id=2001)]
        )

        result = OfflineCatalogImportTask().execute(
            source_path=source_path,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["records_updated"], 0)
        self.assertEqual(Anime.objects.count(), 1)
        self.assertEqual(OfflineCatalogImport.objects.count(), 1)
        self.assertEqual(
            OfflineCatalogImport.objects.first().status,
            OfflineCatalogImport.Status.COMPLETED,
        )

    @skipUnless(zstandard is not None, "zstandard not available in runtime")
    def test_task_execute_imports_from_zst_source(self):
        source_path = self._write_zst_fixture(
            [self._entry(title="Task Import Zst", anilist_id=1002, mal_id=2002)]
        )

        result = OfflineCatalogImportTask().execute(
            source_path=source_path,
            asset_name="anime-offline-database.jsonl.zst",
        )

        self.assertEqual(result["records_created"], 1)
        anime = Anime.objects.get(title="Task Import Zst")
        self.assertEqual(anime.anilist_id, 1002)
        self.assertEqual(anime.mal_id, 2002)

    @patch("apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync.delay")
    def test_task_execute_enqueues_reconcile_and_prepares_state_pipeline(self, mock_reconcile_delay):
        source_path = self._write_jsonl_fixture(
            [
                self._entry(title="Chunk One", anilist_id=1010, mal_id=2010),
                self._entry(title="Chunk Two", anilist_id=1020, mal_id=2020),
            ]
        )

        result = OfflineCatalogImportTask().execute(
            source_path=source_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
            enrichment_chunk_size=1,
        )

        self.assertEqual(result["metadata_queued"], 0)
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 0)
        self.assertEqual(result["sync_states_total"], 2)
        self.assertEqual(OfflineAnimeSyncState.objects.count(), 2)
        mock_reconcile_delay.assert_called_once()

    def test_management_command_runs_import_synchronously(self):
        source_path = self._write_jsonl_fixture(
            [self._entry(title="Command Sync", anilist_id=1101, mal_id=2101)]
        )
        stdout = io.StringIO()

        call_command(
            "sync_anime",
            "import-offline-catalog",
            "--source-path",
            source_path,
            "--import-limit",
            "1",
            stdout=stdout,
        )

        output = stdout.getvalue()
        self.assertIn("Importing Anime Offline Database", output)
        self.assertIn("Task completed successfully", output)
        self.assertTrue(Anime.objects.filter(title="Command Sync").exists())

    @patch("apps.animes.tasks.import_offline_catalog.s")
    def test_management_command_async_queues_task_with_expected_kwargs(self, mock_signature):
        source_path = str(Path(tempfile.gettempdir()) / "offline.jsonl")
        mock_task = Mock()
        mock_task.apply_async.return_value = SimpleNamespace(id="task-123")
        mock_signature.return_value = mock_task
        stdout = io.StringIO()

        call_command(
            "sync_anime",
            "import-offline-catalog",
            "--source-path",
            source_path,
            "--release-tag",
            "latest",
            "--import-limit",
            "2",
            "--enqueue-enrichment",
            "--enrichment-chunk-size",
            "25",
            "--async",
            "--queue",
            "batch",
            stdout=stdout,
        )

        mock_signature.assert_called_once_with(
            release_tag="latest",
            asset_name="anime-offline-database.jsonl.zst",
            source_url=None,
            source_path=source_path,
            limit=2,
            resume=False,
            enqueue_enrichment=True,
            enforce_full_sync=True,
            batch_size=50,
            enrichment_chunk_size=25,
        )
        mock_task.apply_async.assert_called_once_with(queue="batch")

    @patch("apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync.apply_async")
    @patch("apps.animes.tasks.offline_catalog.OfflineSyncService")
    def test_reconcile_task_reschedules_when_default_path_has_backlog(
        self,
        mock_sync_service_cls,
        mock_apply_async,
    ):
        mock_sync_service_cls.return_value.reconcile_due.return_value = {
            "stage_counts": {},
            "reason_counts": {},
            "pending": 5,
            "complete": 0,
            "processed": 2,
            "claimed": 2,
            "transient_backlog": 0,
            "quarantined_count": 0,
            "top_quarantine_reasons": [],
        }
        mock_apply_async.return_value = SimpleNamespace(id="next-round-1")

        result = OfflineCatalogReconcileSyncTask().execute(
            strict=False,
            max_rounds=3,
            round_number=1,
            round_interval_minutes=1,
        )

        self.assertTrue(result["next_round_scheduled"])
        self.assertEqual(result["next_round_task_id"], "next-round-1")
        self.assertFalse(result["rounds_exhausted"])
        mock_apply_async.assert_called_once()
