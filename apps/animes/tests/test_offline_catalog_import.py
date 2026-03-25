import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.db import DataError, IntegrityError
from django.test import TestCase
from django.utils import timezone

from apps.animes.models import Anime, OfflineCatalogImport
from apps.animes.services.offline_catalog import OfflineCatalogImportService


class OfflineCatalogImportServiceTests(TestCase):
    def setUp(self):
        self.enrich_signal_patcher = patch("apps.animes.signals.enrich_metadata.delay")
        self.enrich_signal_patcher.start()
        self.addCleanup(self.enrich_signal_patcher.stop)

    def _write_jsonl_fixture(self, *entries, last_update="2026-03-23") -> str:
        metadata = {
            "$schema": "https://example.com/schema.json",
            "lastUpdate": last_update,
        }
        handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        with handle:
            handle.write(json.dumps(metadata) + "\n")
            for entry in entries:
                handle.write(json.dumps(entry) + "\n")
        return handle.name

    def _entry(self, **overrides):
        payload = {
            "sources": [
                "https://anilist.co/anime/1535",
                "https://myanimelist.net/anime/1535",
                "https://animenewsnetwork.com/encyclopedia/anime.php?id=6592",
                "https://anime-planet.com/anime/death-note",
            ],
            "title": "Death Note",
            "type": "TV",
            "episodes": 37,
            "status": "FINISHED",
            "animeSeason": {"season": "FALL", "year": 2006},
            "picture": "https://cdn.example.com/death-note.jpg",
            "thumbnail": "https://cdn.example.com/death-note-thumb.jpg",
            "duration": {"value": 1440, "unit": "SECONDS"},
            "score": {"arithmeticGeometricMean": 8.6},
            "synonyms": ["DN", "DEATH NOTE"],
            "studios": ["madhouse"],
            "producers": ["vap", "shueisha"],
            "relatedAnime": ["https://anilist.co/anime/2994"],
            "tags": ["psychological", "thriller"],
        }
        payload.update(overrides)
        return payload

    def test_extract_provider_ids_supports_multiple_sources(self):
        service = OfflineCatalogImportService()

        provider_ids = service._extract_provider_ids(
            [
                "https://anilist.co/anime/1535/death-note",
                "https://myanimelist.net/anime/1535/Death_Note",
                "https://animenewsnetwork.com/encyclopedia/anime.php?id=6592",
                "https://notify.moe/anime/0-A-5Fimg",
            ]
        )

        self.assertEqual(provider_ids["anilist"], 1535)
        self.assertEqual(provider_ids["myanimelist"], 1535)
        self.assertEqual(provider_ids["animenewsnetwork"], 6592)
        self.assertEqual(provider_ids["notify_moe"], "0-A-5Fimg")

    def test_run_import_matches_existing_by_ids_extracted_from_slugged_urls(self):
        anime = Anime.objects.create(
            title="Local Placeholder",
            slug="local-placeholder",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=1535,
            mal_id=1535,
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Death Note",
                sources=[
                    "https://anilist.co/anime/1535/death-note",
                    "https://myanimelist.net/anime/1535/Death_Note",
                ],
            )
        )

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        anime.refresh_from_db()
        self.assertEqual(result["records_created"], 0)
        self.assertEqual(result["records_updated"], 1)
        self.assertEqual(Anime.objects.count(), 1)
        self.assertEqual(anime.provider_ids["anilist"], 1535)
        self.assertEqual(anime.provider_ids["myanimelist"], 1535)

    def test_run_import_updates_existing_row_without_overwriting_anilist_owned_fields(self):
        anime = Anime.objects.create(
            title="Death Note",
            slug="death-note",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=1535,
            mal_id=1535,
            relations=[{"id": 1, "title": "Existing relation"}],
            cover_image_external_url="https://existing.example.com/cover.jpg",
            banner_image_external_url="https://existing.example.com/banner.jpg",
            rating=9.1,
        )
        fixture_path = self._write_jsonl_fixture(self._entry())

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        anime.refresh_from_db()

        self.assertEqual(result["records_created"], 0)
        self.assertEqual(result["records_updated"], 1)
        self.assertEqual(anime.relations, [{"id": 1, "title": "Existing relation"}])
        self.assertEqual(anime.cover_image_external_url, "https://existing.example.com/cover.jpg")
        self.assertEqual(anime.banner_image_external_url, "https://existing.example.com/banner.jpg")
        self.assertEqual(float(anime.rating), 9.1)
        self.assertEqual(anime.provider_ids["anilist"], 1535)
        self.assertEqual(anime.provider_ids["myanimelist"], 1535)
        self.assertIn("DN", anime.synonyms)
        self.assertIn("psychological", anime.tags)
        self.assertEqual(anime.offline_db_last_update.isoformat(), "2026-03-23")
        self.assertIsNotNone(anime.offline_db_last_seen_at)

    @patch("apps.animes.tasks.sync_theme_songs.delay")
    @patch("apps.animes.tasks.sync_franchises.delay")
    @patch("apps.animes.tasks.enrich_metadata.delay")
    def test_run_import_creates_rows_and_queues_enrichment(
        self,
        mock_enrich_delay,
        mock_franchise_delay,
        mock_theme_delay,
    ):
        second = self._entry(
            title="Monster",
            sources=[
                "https://anilist.co/anime/19",
                "https://myanimelist.net/anime/19",
            ],
            episodes=74,
            animeSeason={"season": "SPRING", "year": 2004},
        )
        fixture_path = self._write_jsonl_fixture(self._entry(), second)

        result = OfflineCatalogImportService(batch_size=2, enrichment_chunk_size=2).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
        )

        self.assertEqual(Anime.objects.count(), 2)
        self.assertEqual(result["records_created"], 2)
        self.assertEqual(result["metadata_queued"], 1)
        self.assertEqual(result["franchises_queued"], 1)
        self.assertEqual(result["themes_queued"], 1)
        mock_enrich_delay.assert_called_once()
        mock_franchise_delay.assert_called_once()
        mock_theme_delay.assert_called_once()

    @patch("apps.animes.tasks.sync_theme_songs.delay")
    @patch("apps.animes.tasks.sync_franchises.delay")
    @patch("apps.animes.tasks.enrich_metadata.delay")
    def test_run_import_queues_metadata_for_mal_only_entries(
        self,
        mock_enrich_delay,
        mock_franchise_delay,
        mock_theme_delay,
    ):
        entry = self._entry(
            title="MAL Only Entry",
            sources=["https://myanimelist.net/anime/19"],
            animeSeason={"season": "SPRING", "year": 2004},
        )
        fixture_path = self._write_jsonl_fixture(entry)

        result = OfflineCatalogImportService(batch_size=1, enrichment_chunk_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
        )

        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["metadata_queued"], 1)
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 1)
        mock_enrich_delay.assert_called_once()
        mock_franchise_delay.assert_not_called()
        mock_theme_delay.assert_called_once()

    def test_run_import_tracks_stale_rows_without_deleting_them(self):
        stale_anime = Anime.objects.create(
            title="Old Catalog Entry",
            slug="old-catalog-entry",
            synopsis="Stale",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            offline_db_last_seen_at=timezone.now() - timedelta(days=10),
        )
        fixture_path = self._write_jsonl_fixture(self._entry(title="Fresh Entry"))

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        stale_anime.refresh_from_db()
        self.assertEqual(result["records_marked_stale"], 1)
        self.assertTrue(Anime.objects.filter(id=stale_anime.id).exists())
        self.assertLess(stale_anime.offline_db_last_seen_at, timezone.now())
        self.assertEqual(OfflineCatalogImport.objects.count(), 1)

    def test_run_import_avoids_generated_title_variant_collision(self):
        Anime.objects.create(
            title="Doraemon",
            slug="doraemon",
            synopsis="Legacy",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            season_year=1979,
        )
        Anime.objects.create(
            title="Doraemon (2005)",
            slug="doraemon-2005",
            synopsis="Legacy",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            season_year=2005,
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Doraemon",
                sources=["https://anime-planet.com/anime/doraemon-2005"],
                animeSeason={"season": "SPRING", "year": 2005},
            )
        )

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_failed"], 0)
        self.assertEqual(result["records_created"], 1)
        self.assertTrue(Anime.objects.filter(title="Doraemon (2)").exists())

    def test_run_import_does_not_fallback_match_when_only_one_side_has_year(self):
        Anime.objects.create(
            title="The Same Name",
            slug="the-same-name",
            synopsis="Legacy",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="The Same Name",
                sources=["https://anime-planet.com/anime/the-same-name-2020"],
                animeSeason={"season": "SPRING", "year": 2020},
            )
        )

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["records_updated"], 0)
        self.assertEqual(Anime.objects.filter(title__startswith="The Same Name").count(), 2)

    def test_ensure_unique_slug_keeps_length_with_numeric_suffix(self):
        service = OfflineCatalogImportService()
        reserved = {"a" * 200}

        slug = service._ensure_unique_slug("a" * 260, reserved)

        self.assertLessEqual(len(slug), 200)
        self.assertTrue(slug.endswith("-2"))

    @patch("apps.animes.services.offline_catalog.Anime.objects.bulk_create")
    def test_run_import_falls_back_to_row_saves_when_bulk_create_fails(self, mock_bulk_create):
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Fallback Save",
                episodes=12,
                animeSeason={"season": "SUMMER", "year": 2023},
            )
        )
        mock_bulk_create.side_effect = IntegrityError("forced conflict")

        result = OfflineCatalogImportService(batch_size=10).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_failed"], 0)
        self.assertEqual(result["records_created"], 1)
        self.assertTrue(Anime.objects.filter(title="Fallback Save").exists())
        mock_bulk_create.assert_called_once()

    @patch("apps.animes.services.offline_catalog.Anime.objects.bulk_create")
    def test_run_import_falls_back_to_row_saves_when_bulk_create_raises_data_error(
        self, mock_bulk_create
    ):
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Fallback Data Error",
                episodes=12,
                animeSeason={"season": "SUMMER", "year": 2023},
            )
        )
        mock_bulk_create.side_effect = DataError("forced overflow")

        result = OfflineCatalogImportService(batch_size=10).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_failed"], 0)
        self.assertEqual(result["records_created"], 1)
        self.assertTrue(Anime.objects.filter(title="Fallback Data Error").exists())
        mock_bulk_create.assert_called_once()

    def test_run_import_truncates_overlong_fields_to_fit_model_limits(self):
        long_title = "Very Long Title " * 30
        long_cover = "https://cdn.example.com/" + ("a" * 400)
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title=long_title,
                picture=long_cover,
                thumbnail=long_cover,
                animeSeason={"season": "SPRING", "year": 2024},
            )
        )

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        anime = Anime.objects.get()
        self.assertEqual(result["records_failed"], 0)
        self.assertEqual(result["records_created"], 1)
        self.assertLessEqual(len(anime.title), 200)
        self.assertLessEqual(len(anime.slug), 200)
        self.assertLessEqual(len(anime.cover_image_external_url), 200)
        self.assertLessEqual(len(anime.banner_image_external_url), 200)

    def test_run_import_skips_malformed_json_lines(self):
        metadata = {
            "$schema": "https://example.com/schema.json",
            "lastUpdate": "2026-03-23",
        }
        handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        with handle:
            handle.write(json.dumps(metadata) + "\n")
            handle.write("{invalid-json\n")
            handle.write(json.dumps(self._entry(title="Valid After Broken Line")) + "\n")

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=handle.name,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_failed"], 1)
        self.assertEqual(result["records_created"], 1)
        self.assertEqual(OfflineCatalogImport.objects.get().status, OfflineCatalogImport.Status.COMPLETED)

    def test_run_import_skips_non_object_json_payload_lines(self):
        metadata = {
            "$schema": "https://example.com/schema.json",
            "lastUpdate": "2026-03-23",
        }
        handle = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        with handle:
            handle.write(json.dumps(metadata) + "\n")
            handle.write(json.dumps(["not", "an", "object"]) + "\n")
            handle.write(json.dumps(self._entry(title="Valid After Array Line")) + "\n")

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=handle.name,
            asset_name="anime-offline-database.jsonl",
        )

        self.assertEqual(result["records_failed"], 1)
        self.assertEqual(result["records_created"], 1)
        self.assertEqual(OfflineCatalogImport.objects.get().status, OfflineCatalogImport.Status.COMPLETED)

    def test_run_import_merges_duplicate_ids_within_same_batch(self):
        first = self._entry(
            title="Duplicate Identity",
            sources=[
                "https://anilist.co/anime/777777",
                "https://myanimelist.net/anime/888888",
            ],
            synonyms=["First Alias"],
            tags=["mystery"],
        )
        second = self._entry(
            title="Duplicate Identity",
            sources=[
                "https://anilist.co/anime/777777",
                "https://myanimelist.net/anime/888888",
            ],
            synonyms=["Second Alias"],
            tags=["thriller"],
        )
        fixture_path = self._write_jsonl_fixture(first, second)

        result = OfflineCatalogImportService(batch_size=10).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        anime = Anime.objects.get(anilist_id=777777)
        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["records_updated"], 0)
        self.assertEqual(result["records_failed"], 0)
        self.assertEqual(Anime.objects.count(), 1)
        self.assertIn("First Alias", anime.synonyms)
        self.assertIn("Second Alias", anime.synonyms)
        self.assertIn("mystery", anime.tags)
        self.assertIn("thriller", anime.tags)

    @patch("apps.animes.tasks.sync_theme_songs.delay")
    @patch("apps.animes.tasks.sync_franchises.delay")
    @patch("apps.animes.tasks.enrich_metadata.delay")
    def test_run_import_continues_when_enrichment_dispatch_fails(
        self,
        mock_enrich_delay,
        mock_franchise_delay,
        mock_theme_delay,
    ):
        mock_enrich_delay.side_effect = RuntimeError("broker unavailable")
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Dispatch Failure Safety",
                sources=[
                    "https://anilist.co/anime/909090",
                    "https://myanimelist.net/anime/909090",
                ],
            )
        )

        result = OfflineCatalogImportService(batch_size=1, enrichment_chunk_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
        )

        import_run = OfflineCatalogImport.objects.get()
        self.assertEqual(import_run.status, OfflineCatalogImport.Status.COMPLETED)
        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["metadata_queued"], 0)
        self.assertEqual(result["franchises_queued"], 1)
        self.assertEqual(result["themes_queued"], 1)
        mock_enrich_delay.assert_called_once()
        mock_franchise_delay.assert_called_once()
        mock_theme_delay.assert_called_once()

    @patch("apps.animes.tasks.sync_theme_songs.delay")
    @patch("apps.animes.tasks.sync_franchises.delay")
    @patch("apps.animes.tasks.enrich_metadata.delay")
    def test_zero_enrichment_chunk_size_is_safely_clamped(
        self,
        mock_enrich_delay,
        mock_franchise_delay,
        mock_theme_delay,
    ):
        fixture_path = self._write_jsonl_fixture(self._entry(title="Chunk Clamp Safety"))

        result = OfflineCatalogImportService(batch_size=1, enrichment_chunk_size=0).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
        )

        self.assertEqual(result["metadata_queued"], 1)
        self.assertEqual(result["franchises_queued"], 1)
        self.assertEqual(result["themes_queued"], 1)
        mock_enrich_delay.assert_called_once()
        mock_franchise_delay.assert_called_once()
        mock_theme_delay.assert_called_once()

    @patch("apps.animes.services.offline_catalog.httpx.Client")
    def test_open_remote_stream_uses_stream_context_response(self, mock_client_cls):
        flags = {"entered": False, "exited": False, "closed": False}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def iter_bytes(self):
                yield b'{"hello":"world"}\n'

        class FakeStreamContext:
            def __enter__(self):
                flags["entered"] = True
                return FakeResponse()

            def __exit__(self, exc_type, exc, tb):
                flags["exited"] = True
                return False

        class FakeClient:
            def stream(self, method, url):
                self.method = method
                self.url = url
                return FakeStreamContext()

            def close(self):
                flags["closed"] = True

        mock_client_cls.return_value = FakeClient()

        service = OfflineCatalogImportService()
        with service._open_remote_stream("https://example.com/offline.jsonl") as text_stream:
            line = next(text_stream).strip()

        self.assertEqual(line, '{"hello":"world"}')
        self.assertTrue(flags["entered"])
        self.assertTrue(flags["exited"])
        self.assertTrue(flags["closed"])

    @patch("apps.animes.services.offline_catalog.httpx.Client")
    def test_open_remote_stream_falls_back_to_jsonl_when_zstandard_missing(self, mock_client_cls):
        calls = {"url": None}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def iter_bytes(self):
                yield b'{"hello":"world"}\n'

        class FakeStreamContext:
            def __enter__(self):
                return FakeResponse()

            def __exit__(self, exc_type, exc, tb):
                return False

        class FakeClient:
            def stream(self, method, url):
                calls["url"] = url
                return FakeStreamContext()

            def close(self):
                return None

        mock_client_cls.return_value = FakeClient()

        service = OfflineCatalogImportService()
        with patch.object(service, "_get_zstandard", side_effect=ModuleNotFoundError("zstandard")):
            with service._open_remote_stream("https://example.com/offline.jsonl.zst") as text_stream:
                line = next(text_stream).strip()

        self.assertEqual(line, '{"hello":"world"}')
        self.assertEqual(calls["url"], "https://example.com/offline.jsonl")
