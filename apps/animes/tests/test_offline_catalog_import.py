import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.db import DataError, IntegrityError
from django.test import TestCase
from django.utils import timezone

from ..models import Anime, OfflineAnimeSyncState, OfflineCatalogImport
from ..services.offline_catalog import OfflineCatalogImportService
from ..services.relation_links import set_relations


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
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as handle:
            self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
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

    def test_run_import_matches_existing_by_alternate_titles_when_ids_are_missing(self):
        anime = Anime.objects.create(
            title="Hikikomari Kyuuketsuki no Monmon",
            title_jp="ひきこまり吸血姫の悶々",
            slug="hikikomari-kyuuketsuki-no-monmon",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            season_year=2023,
            synonyms=[
                "Hikikomari Kyūketsuki no Monmon",
                "The Vexations of a Shut-In Vampire Princess",
            ],
            provider_ids={
                "anilist": 159808,
                "myanimelist": 54103,
                "anime_planet": "the-vexations-of-a-shut-in-vampire-princess",
            },
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="The Vexations of a Shut-In Vampire Princess",
                sources=["https://animenewsnetwork.com/encyclopedia/anime.php?id=26817"],
                synonyms=[
                    "Hikikomari Kyūketsuki no Monmon",
                    "ひきこまり吸血姫の悶々",
                ],
                animeSeason={"season": "FALL", "year": 2023},
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
        self.assertEqual(anime.provider_ids["animenewsnetwork"], 26817)
        self.assertIn(
            "https://animenewsnetwork.com/encyclopedia/anime.php?id=26817",
            anime.source_urls,
        )

    def test_run_import_matches_existing_by_secondary_provider_id_when_ids_are_missing(self):
        anime = Anime.objects.create(
            title="Romaji Primary Title",
            slug="romaji-primary-title",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            season_year=2024,
            provider_ids={"anime_planet": "shared-provider-slug"},
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="Completely Different Localized Title",
                sources=["https://anime-planet.com/anime/shared-provider-slug"],
                synonyms=["Unrelated Alias"],
                animeSeason={"season": "SPRING", "year": 2024},
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
        self.assertEqual(anime.provider_ids["anime_planet"], "shared-provider-slug")
        self.assertIn("Unrelated Alias", anime.synonyms)

    def test_run_import_matches_existing_by_provider_ids_even_when_incoming_ids_exist(self):
        anime = Anime.objects.create(
            title="One Punch Man",
            slug="one-punch-man",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            season_year=2015,
            provider_ids={"myanimelist": 30276},
        )
        fixture_path = self._write_jsonl_fixture(
            self._entry(
                title="One Punch Man",
                sources=[
                    "https://anilist.co/anime/21087",
                    "https://myanimelist.net/anime/30276/One_Punch_Man",
                ],
                animeSeason={"season": "FALL", "year": 2015},
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
        self.assertEqual(anime.anilist_id, 21087)
        self.assertEqual(anime.mal_id, 30276)

    def test_run_import_updates_existing_row_without_overwriting_anilist_owned_fields(self):
        anime = Anime.objects.create(
            title="Death Note",
            slug="death-note",
            synopsis="Existing synopsis",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            anilist_id=1535,
            mal_id=1535,
            cover_image_external_url="https://existing.example.com/cover.jpg",
            banner_image_external_url="https://existing.example.com/banner.jpg",
            rating=9.1,
        )
        set_relations(anime, [{"id": 1, "title": "Existing relation"}])
        fixture_path = self._write_jsonl_fixture(self._entry())

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
        )

        anime.refresh_from_db()

        self.assertEqual(result["records_created"], 0)
        self.assertEqual(result["records_updated"], 1)
        self.assertEqual(
            list(anime.relations.values_list("target_anilist_id", "title")),
            [(1, "Existing relation")],
        )
        self.assertEqual(anime.cover_image_external_url, "https://existing.example.com/cover.jpg")
        self.assertEqual(anime.banner_image_external_url, "https://existing.example.com/banner.jpg")
        self.assertEqual(float(anime.rating), 9.1)
        self.assertEqual(anime.provider_ids["anilist"], 1535)
        self.assertEqual(anime.provider_ids["myanimelist"], 1535)
        self.assertIn("DN", anime.synonyms)
        self.assertIn("psychological", anime.tags)
        self.assertEqual(anime.offline_db_last_update.isoformat(), "2026-03-23")
        self.assertIsNotNone(anime.offline_db_last_seen_at)

    def test_run_import_creates_rows_and_prepares_sync_state_pipeline(self):
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
        self.assertEqual(result["metadata_queued"], 0)
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 0)
        self.assertEqual(result["sync_states_total"], 2)
        self.assertEqual(OfflineAnimeSyncState.objects.count(), 2)

    def test_run_import_without_enrichment_does_not_create_pending_sync_states(self):
        fixture_path = self._write_jsonl_fixture(self._entry(title="Import Only"))

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=False,
        )

        self.assertEqual(result["records_created"], 1)
        self.assertEqual(result["sync_states_total"], 0)
        self.assertEqual(OfflineAnimeSyncState.objects.count(), 0)

    def test_run_import_prepares_sync_states_for_mal_only_entries(self):
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
        self.assertEqual(result["metadata_queued"], 0)
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 0)
        state = OfflineAnimeSyncState.objects.get()
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)
        self.assertEqual(state.franchise_status, OfflineAnimeSyncState.StageStatus.PENDING)
        self.assertEqual(state.themes_status, OfflineAnimeSyncState.StageStatus.PENDING)

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

    def test_resume_import_uses_original_run_window_for_stale_count(self):
        first_path = self._write_jsonl_fixture(
            self._entry(
                title="Resume Window One",
                sources=["https://anilist.co/anime/91001", "https://myanimelist.net/anime/91001"],
            )
        )

        OfflineCatalogImportService(batch_size=1).run_import(
            source_path=first_path,
            asset_name="anime-offline-database.jsonl",
        )
        import_run = OfflineCatalogImport.objects.get()
        original_started_at = import_run.started_at
        import_run.status = OfflineCatalogImport.Status.FAILED
        import_run.error_message = "partial remote read"
        import_run.completed_at = timezone.now()
        import_run.save(update_fields=["status", "error_message", "completed_at"])

        Anime.objects.create(
            title="Pre Import Stale",
            slug="pre-import-stale",
            synopsis="Stale before resume",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.finished,
            offline_db_last_seen_at=original_started_at - timedelta(days=1),
        )
        second_path = self._write_jsonl_fixture(
            self._entry(
                title="Resume Window One",
                sources=["https://anilist.co/anime/91001", "https://myanimelist.net/anime/91001"],
            ),
            self._entry(
                title="Resume Window Two",
                sources=["https://anilist.co/anime/91002", "https://myanimelist.net/anime/91002"],
            ),
        )

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=second_path,
            asset_name="anime-offline-database.jsonl",
            resume=True,
        )

        first = Anime.objects.get(title="Resume Window One")
        second = Anime.objects.get(title="Resume Window Two")
        import_run.refresh_from_db()
        self.assertEqual(import_run.status, OfflineCatalogImport.Status.COMPLETED)
        self.assertEqual(result["records_marked_stale"], 1)
        self.assertEqual(first.offline_db_last_seen_at, original_started_at)
        self.assertEqual(second.offline_db_last_seen_at, original_started_at)
        self.assertEqual(set(result["changed_anime_ids"]), {first.id, second.id})

    def test_run_import_keeps_shared_titles_and_only_varies_the_slug(self):
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
        created = Anime.objects.exclude(slug__in=["doraemon", "doraemon-2005"]).get()
        self.assertEqual(created.title, "Doraemon")
        self.assertEqual(created.slug, "doraemon-2")

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
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as handle:
            fixture_path = handle.name
            handle.write(json.dumps(metadata) + "\n")
            handle.write("{invalid-json\n")
            handle.write(json.dumps(self._entry(title="Valid After Broken Line")) + "\n")
        self.addCleanup(lambda: Path(fixture_path).unlink(missing_ok=True))

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
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
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as handle:
            fixture_path = handle.name
            handle.write(json.dumps(metadata) + "\n")
            handle.write(json.dumps(["not", "an", "object"]) + "\n")
            handle.write(json.dumps(self._entry(title="Valid After Array Line")) + "\n")
        self.addCleanup(lambda: Path(fixture_path).unlink(missing_ok=True))

        result = OfflineCatalogImportService(batch_size=1).run_import(
            source_path=fixture_path,
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

    def test_run_import_completes_with_state_pipeline_enabled(self):
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
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 0)
        self.assertEqual(OfflineAnimeSyncState.objects.count(), 1)

    def test_zero_enrichment_chunk_size_is_ignored_by_state_pipeline(self):
        fixture_path = self._write_jsonl_fixture(self._entry(title="Chunk Clamp Safety"))

        result = OfflineCatalogImportService(batch_size=1, enrichment_chunk_size=0).run_import(
            source_path=fixture_path,
            asset_name="anime-offline-database.jsonl",
            enqueue_enrichment=True,
        )

        self.assertEqual(result["metadata_queued"], 0)
        self.assertEqual(result["franchises_queued"], 0)
        self.assertEqual(result["themes_queued"], 0)

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
        with (
            patch.object(service, "_get_zstandard", side_effect=ModuleNotFoundError("zstandard")),
            service._open_remote_stream("https://example.com/offline.jsonl.zst") as text_stream,
        ):
            line = next(text_stream).strip()

        self.assertEqual(line, '{"hello":"world"}')
        self.assertEqual(calls["url"], "https://example.com/offline.jsonl")


class OfflineCatalogRobustnessTests(TestCase):
    setUp = OfflineCatalogImportServiceTests.setUp
    _write_jsonl_fixture = OfflineCatalogImportServiceTests._write_jsonl_fixture
    _entry = OfflineCatalogImportServiceTests._entry

    def test_malformed_records_are_counted_and_the_import_completes(self):
        path = self._write_jsonl_fixture(
            self._entry(title="Broken Sources", sources=[123]),
            self._entry(
                title="Stringly Typed",
                sources=["https://anilist.co/anime/9001"],
                animeSeason={"season": "FALL", "year": "2020"},
                episodes="?",
                duration={"value": "1440", "unit": "SECONDS"},
                score={"arithmeticGeometricMean": "n/a"},
            ),
            self._entry(),
        )

        OfflineCatalogImportService().run_import(source_path=path)

        run = OfflineCatalogImport.objects.latest("created_at")
        self.assertEqual(run.status, OfflineCatalogImport.Status.COMPLETED)
        self.assertEqual(run.records_failed, 1)
        self.assertTrue(Anime.objects.filter(title="Death Note").exists())
        stringly = Anime.objects.get(title="Stringly Typed")
        self.assertEqual(stringly.season_year, 2020)
        self.assertEqual(stringly.episode_count, 0)
        self.assertEqual(stringly.duration_minutes, 24)

    def test_reimport_keeps_sync_progress_and_admin_quarantines(self):
        synced = Anime.objects.create(title="Synced", slug="synced")
        merged = Anime.objects.create(title="Merged Duplicate", slug="merged-duplicate")
        new = Anime.objects.create(title="New", slug="new")
        done = OfflineAnimeSyncState.StageStatus.SYNCED
        OfflineAnimeSyncState.objects.create(
            anime=synced, metadata_status=done, franchise_status=done, themes_status=done
        )
        OfflineAnimeSyncState.objects.create(
            anime=merged,
            quarantined=True,
            quarantine_reason="merged_into:1",
            quarantine_context={"manual": True, "action": "mark_skipped"},
        )

        OfflineCatalogImportService()._initialize_sync_states([new.id], [synced.id, merged.id])

        self.assertEqual(OfflineAnimeSyncState.objects.get(anime=synced).metadata_status, done)
        merged_state = OfflineAnimeSyncState.objects.get(anime=merged)
        self.assertTrue(merged_state.quarantined)
        self.assertEqual(merged_state.quarantine_reason, "merged_into:1")
        self.assertEqual(
            OfflineAnimeSyncState.objects.get(anime=new).metadata_status,
            OfflineAnimeSyncState.StageStatus.PENDING,
        )

    def test_import_does_not_revert_fields_changed_by_another_sync_meanwhile(self):
        anime = Anime.objects.create(
            title="Death Note", slug="death-note", anilist_id=1535, mal_id=1535,
            status=Anime.AnimeStatus.airing, episode_count=37,
        )
        path = self._write_jsonl_fixture(self._entry())
        original_fill = OfflineCatalogImportService._fill_offline_fields

        def airing_sync_lands_first(service, row, *args):
            # The import already loaded `row`; another sync finishes the show now.
            Anime.objects.filter(pk=row.pk).update(status=Anime.AnimeStatus.finished)
            return original_fill(service, row, *args)

        with patch.object(
            OfflineCatalogImportService, "_fill_offline_fields", airing_sync_lands_first
        ):
            OfflineCatalogImportService().run_import(source_path=path)

        anime.refresh_from_db()
        self.assertEqual(anime.status, Anime.AnimeStatus.finished)
        self.assertIsNotNone(anime.offline_db_last_seen_at)
