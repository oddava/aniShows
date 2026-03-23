import io
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import zstandard
from django.core.management import call_command
from django.test import TestCase

from apps.animes.models import Anime, OfflineCatalogImport
from apps.animes.tasks.offline_catalog import OfflineCatalogImportTask


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
        handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        with handle:
            handle.write(json.dumps(metadata) + "\n")
            for entry in entries:
                handle.write(json.dumps(entry) + "\n")
        return handle.name

    def _write_zst_fixture(self, entries: list[dict], last_update: str = "2026-03-23") -> str:
        metadata = {"$schema": "https://example.com/schema.json", "lastUpdate": last_update}
        payload_lines = [json.dumps(metadata), *[json.dumps(entry) for entry in entries]]
        payload = ("\n".join(payload_lines) + "\n").encode("utf-8")

        handle = tempfile.NamedTemporaryFile("wb", suffix=".jsonl.zst", delete=False)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        compressor = zstandard.ZstdCompressor()
        with handle:
            handle.write(compressor.compress(payload))
        return handle.name

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

    @patch("apps.animes.tasks.sync_theme_songs.delay")
    @patch("apps.animes.tasks.sync_franchises.delay")
    @patch("apps.animes.tasks.enrich_metadata.delay")
    def test_task_execute_enqueues_enrichment_in_chunks(
        self,
        mock_enrich_delay,
        mock_franchise_delay,
        mock_theme_delay,
    ):
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

        self.assertEqual(result["metadata_queued"], 2)
        self.assertEqual(result["franchises_queued"], 2)
        self.assertEqual(result["themes_queued"], 2)
        self.assertEqual(mock_enrich_delay.call_count, 2)
        self.assertEqual(mock_franchise_delay.call_count, 2)
        self.assertEqual(mock_theme_delay.call_count, 2)

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
        source_path = "/tmp/offline.jsonl"
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
            batch_size=50,
            enrichment_chunk_size=25,
        )
        mock_task.apply_async.assert_called_once_with(queue="batch")
