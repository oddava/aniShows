from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone

from ..models import Anime, OfflineAnimeSyncState
from ..services.anilist import AniListService
from ..services.offline_catalog import PLACEHOLDER_SYNOPSIS
from ..services.offline_sync import (
    STATE_BULK_CREATE_BATCH_SIZE,
    OfflineSyncService,
    StageResult,
)


class OfflineSyncStatePipelineTests(TestCase):
    def _anime(self, title: str, **overrides) -> Anime:
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "Placeholder",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "offline_db_last_seen_at": timezone.now(),
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def _state(self, anime: Anime, **overrides) -> OfflineAnimeSyncState:
        payload = {"anime": anime, "next_attempt_at": timezone.now() - timedelta(minutes=1)}
        payload.update(overrides)
        return OfflineAnimeSyncState.objects.create(**payload)

    @patch.object(AniListService, "search_anime", new_callable=MagicMock)
    def test_title_only_lookup_failure_marks_row_without_mutating_identity(self, mock_search):
        anime = self._anime("No IDs")
        mock_search.return_value = []
        result = OfflineSyncService().sync_metadata_stage(anime)
        anime.refresh_from_db()

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS)
        self.assertEqual(result.reason_code, "not_found")
        self.assertIsNone(anime.anilist_id)
        self.assertIsNone(anime.mal_id)

    @patch.object(AniListService, "refresh_anime_metadata", new_callable=MagicMock)
    @patch.object(AniListService, "search_anime", new_callable=MagicMock)
    def test_title_only_lookup_can_enrich_via_exact_match(self, mock_search, mock_update):
        anime = self._anime("Title Only")
        mock_search.return_value = [
            {
                "id": 321,
                "idMal": 654,
                "title": {"english": "Title Only", "romaji": "Title Only", "native": ""},
            }
        ]
        mock_update.return_value = True

        result = OfflineSyncService().sync_metadata_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.SYNCED)
        mock_update.assert_called_once()

    @patch.object(AniListService, "refresh_anime_metadata", new_callable=MagicMock)
    @patch.object(AniListService, "get_anime_by_id", new_callable=MagicMock)
    def test_identity_conflict_never_updates_identity_fields(self, mock_get_by_id, mock_update):
        anime = self._anime("Conflict", anilist_id=111, mal_id=222)
        mock_get_by_id.return_value = {"id": 999, "idMal": 333}

        result = OfflineSyncService().sync_metadata_stage(anime)
        anime.refresh_from_db()

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY)
        self.assertEqual(result.reason_code, "identity_conflict")
        self.assertEqual(anime.anilist_id, 111)
        self.assertEqual(anime.mal_id, 222)
        mock_update.assert_not_called()

    @patch.object(AniListService, "refresh_anime_metadata", new_callable=MagicMock)
    @patch.object(AniListService, "search_by_mal_id", new_callable=MagicMock)
    @patch.object(AniListService, "get_anime_by_id", new_callable=MagicMock)
    def test_metadata_stage_looks_up_by_anilist_id_first(
        self,
        mock_get_by_id,
        mock_search_by_mal_id,
        mock_update,
    ):
        anime = self._anime("By AniList", anilist_id=111, mal_id=222)
        mock_get_by_id.return_value = {
            "id": 111,
            "idMal": 222,
            "title": {"english": "By AniList", "romaji": "By AniList", "native": ""},
        }
        mock_update.return_value = True

        result = OfflineSyncService().sync_metadata_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.SYNCED)
        mock_get_by_id.assert_called_once_with(111)
        mock_search_by_mal_id.assert_not_called()
        mock_update.assert_called_once_with(anime, mock_get_by_id.return_value)

    @patch.object(AniListService, "refresh_anime_metadata", new_callable=MagicMock)
    @patch.object(AniListService, "search_by_mal_id", new_callable=MagicMock)
    @patch.object(AniListService, "get_anime_by_id", new_callable=MagicMock)
    def test_metadata_stage_falls_back_to_the_mal_id(
        self, mock_get_by_id, mock_search_by_mal_id, mock_update
    ):
        anime = self._anime("MAL Only", mal_id=222)
        mock_search_by_mal_id.return_value = {"id": 111, "idMal": 222}
        mock_update.return_value = True

        result = OfflineSyncService().sync_metadata_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.SYNCED)
        mock_get_by_id.assert_not_called()
        mock_search_by_mal_id.assert_called_once_with(222)

    @patch.object(AniListService, "search_anime", new_callable=MagicMock)
    def test_metadata_stage_rate_limit_is_transient_and_skips_title_search(self, mock_search):
        anime = self._anime("Throttled", anilist_id=5)

        def rate_limited(service, anilist_id):
            service._set_last_error("rate_limited", "http_429:GetAnimeById")
            return None

        with patch.object(AniListService, "get_anime_by_id", rate_limited):
            result = OfflineSyncService().sync_metadata_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
        self.assertEqual(result.reason_code, "rate_limited")
        mock_search.assert_not_called()

    @patch.object(AniListService, "get_anime_by_id", new_callable=MagicMock)
    def test_franchise_stage_stores_relations_from_the_anilist_payload(self, mock_get_by_id):
        anime = self._anime("Franchise", anilist_id=50)
        target = self._anime("Sequel", anilist_id=51)
        mock_get_by_id.return_value = {
            "id": 50,
            "idMal": None,
            "relations": {
                "edges": [
                    {
                        "relationType": "SEQUEL",
                        "node": {
                            "id": 51,
                            "idMal": 9,
                            "type": "ANIME",
                            "title": {"romaji": "Sequel"},
                        },
                    }
                ]
            },
        }

        result = OfflineSyncService().sync_franchise_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.SYNCED)
        mock_get_by_id.assert_called_once_with(50)
        relation = anime.relations.get()
        self.assertEqual(relation.relation_type, "SEQUEL")
        self.assertEqual(relation.to_anime_id, target.id)

    @patch.object(AniListService, "search_by_mal_id", new_callable=MagicMock)
    def test_franchise_stage_rejects_a_mal_mismatch(self, mock_search_by_mal_id):
        anime = self._anime("MAL Franchise", mal_id=10)
        mock_search_by_mal_id.return_value = {"id": 1, "idMal": 11, "relations": {"edges": []}}

        result = OfflineSyncService().sync_franchise_stage(anime)

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY)

    def test_franchise_stage_needs_an_id(self):
        result = OfflineSyncService().sync_franchise_stage(self._anime("No IDs At All"))

        self.assertEqual(result.status, OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS)
        self.assertEqual(result.reason_code, "missing_ids")

    def test_ensure_states_resets_synced_placeholder_rows_back_to_pending(self):
        anime = self._anime(
            "Placeholder Repair",
            synopsis=PLACEHOLDER_SYNOPSIS,
            anilist_id=4040,
        )
        state = self._state(
            anime,
            metadata_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            franchise_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            metadata_attempt_count=3,
            next_attempt_at=timezone.now() + timedelta(days=30),
        )

        summary = OfflineSyncService().ensure_states_for_anime_ids([anime.id])
        state.refresh_from_db()

        self.assertEqual(summary["created"], 0)
        self.assertEqual(summary["updated"], 1)
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)
        self.assertEqual(state.metadata_attempt_count, 0)
        self.assertEqual(state.franchise_status, OfflineAnimeSyncState.StageStatus.SYNCED)
        self.assertLessEqual(state.next_attempt_at, timezone.now() + timedelta(seconds=5))

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_transient_failure_schedules_fast_retry_backoff(self, mock_stage):
        anime = self._anime("Transient", anilist_id=100, mal_id=200)
        state = self._state(anime)

        mock_stage.return_value = StageResult(
            status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR,
            reason_code="transport_error",
            reason_message="timeout",
            transient=True,
        )
        OfflineSyncService().reconcile_due(batch_size=1)
        state.refresh_from_db()
        first_eta = state.next_attempt_at

        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
        self.assertEqual(state.metadata_attempt_count, 1)
        self.assertGreaterEqual((first_eta - timezone.now()).total_seconds(), 50)

        state.next_attempt_at = timezone.now() - timedelta(seconds=1)
        state.save(update_fields=["next_attempt_at"])
        OfflineSyncService().reconcile_due(batch_size=1)
        state.refresh_from_db()
        second_eta = state.next_attempt_at

        self.assertEqual(state.metadata_attempt_count, 2)
        self.assertGreaterEqual((second_eta - timezone.now()).total_seconds(), 280)

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_rate_limited_failure_uses_more_conservative_backoff(self, mock_stage):
        anime = self._anime("Rate Limited", anilist_id=101, mal_id=201)
        state = self._state(anime)

        mock_stage.return_value = StageResult(
            status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR,
            reason_code="rate_limited",
            reason_message="http_429",
            transient=True,
        )

        OfflineSyncService().reconcile_due(batch_size=1)
        state.refresh_from_db()

        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
        self.assertGreaterEqual((state.next_attempt_at - timezone.now()).total_seconds(), 280)

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_blocked_status_quarantines_after_threshold(self, mock_stage):
        anime = self._anime("Blocked", anilist_id=10)
        state = self._state(anime)

        mock_stage.return_value = StageResult(
            status=OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS,
            reason_code="invalid_ids",
            reason_message="bad mal",
            transient=False,
        )
        service = OfflineSyncService()

        service.reconcile_due(batch_size=1)
        state.refresh_from_db()
        self.assertFalse(state.quarantined)
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS)

        state.next_attempt_at = timezone.now() - timedelta(seconds=1)
        state.save(update_fields=["next_attempt_at"])
        service.reconcile_due(batch_size=1)
        state.refresh_from_db()

        self.assertTrue(state.quarantined)
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.QUARANTINED)
        self.assertEqual(state.quarantine_reason, "invalid_ids")

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_due_filtering_and_chunking_process_only_due_subset(self, mock_stage):
        mock_stage.return_value = StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)

        due_one = self._state(self._anime("Due One", anilist_id=1))
        due_two = self._state(self._anime("Due Two", anilist_id=2))
        future = self._state(
            self._anime("Future", anilist_id=3),
            next_attempt_at=timezone.now() + timedelta(hours=1),
        )

        result = OfflineSyncService().reconcile_due(batch_size=2)
        due_one.refresh_from_db()
        due_two.refresh_from_db()
        future.refresh_from_db()

        self.assertEqual(result["claimed"], 2)
        self.assertEqual(result["processed"], 2)
        self.assertEqual(due_one.metadata_status, OfflineAnimeSyncState.StageStatus.SYNCED)
        self.assertEqual(due_two.metadata_status, OfflineAnimeSyncState.StageStatus.SYNCED)
        self.assertEqual(future.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_successful_stage_waits_before_advancing_to_next_stage(self, mock_stage):
        mock_stage.return_value = StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)
        state = self._state(self._anime("Inter Stage Delay", anilist_id=88))

        OfflineSyncService().reconcile_due(batch_size=1)
        state.refresh_from_db()

        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.SYNCED)
        self.assertGreaterEqual((state.next_attempt_at - timezone.now()).total_seconds(), 50)

    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_in_progress_state_is_not_reclaimed_during_lease(self, mock_stage):
        mock_stage.return_value = StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)
        anime = self._anime("Lease", anilist_id=77)
        self._state(
            anime,
            metadata_status=OfflineAnimeSyncState.StageStatus.IN_PROGRESS,
            last_attempt_at=timezone.now(),
            next_attempt_at=timezone.now() - timedelta(seconds=1),
        )

        result = OfflineSyncService().reconcile_due(batch_size=1)
        self.assertEqual(result["claimed"], 0)
        self.assertEqual(result["processed"], 0)

    @patch("apps.animes.services.offline_sync.OfflineAnimeSyncState.objects.bulk_create")
    def test_ensure_states_uses_batched_bulk_create(self, mock_bulk_create):
        anime_ids = [
            self._anime(f"Batch {index}", anilist_id=1000 + index).id for index in range(3)
        ]

        summary = OfflineSyncService().ensure_states_for_anime_ids(anime_ids)

        self.assertEqual(summary, {"created": 3, "updated": 0})
        mock_bulk_create.assert_called_once()
        _, kwargs = mock_bulk_create.call_args
        self.assertEqual(kwargs["batch_size"], STATE_BULK_CREATE_BATCH_SIZE)
        self.assertTrue(kwargs["ignore_conflicts"])

    @patch("apps.animes.services.offline_sync.logger.warning")
    @patch("apps.animes.services.offline_sync.logger.info")
    def test_blocked_stage_failure_logs_at_info(self, mock_info, mock_warning):
        anime = self._anime("Blocked Log", anilist_id=404)

        OfflineSyncService()._log_stage_failure(
            anime=anime,
            stage="metadata",
            reason_code="not_found",
            message="AniList media not found.",
            quarantined=False,
        )

        self.assertGreaterEqual(mock_info.call_count, 1)
        self.assertEqual(mock_info.call_args_list[-1].args[1], "Offline sync stage blocked")
        mock_warning.assert_not_called()

    @patch("apps.animes.services.offline_sync.logger.warning")
    @patch("apps.animes.services.offline_sync.logger.info")
    def test_transient_stage_failure_logs_at_warning(self, mock_info, mock_warning):
        anime = self._anime("Transient Log", anilist_id=505)

        OfflineSyncService()._log_stage_failure(
            anime=anime,
            stage="metadata",
            reason_code="transport_error",
            message="timeout",
            quarantined=False,
        )

        mock_warning.assert_called_once()
        self.assertEqual(mock_warning.call_args.args[1], "Offline sync stage retry scheduled")


class OfflineSyncRecoveryTests(TestCase):
    _anime = OfflineSyncStatePipelineTests._anime
    _state = OfflineSyncStatePipelineTests._state

    def test_admin_retry_gives_quarantined_stages_fresh_attempts(self):
        done = OfflineAnimeSyncState.StageStatus.SYNCED
        state = self._state(
            self._anime("Quarantined"),
            metadata_status=done,
            metadata_attempt_count=1,
            franchise_status=OfflineAnimeSyncState.StageStatus.QUARANTINED,
            franchise_attempt_count=12,
            attempt_count=13,
            quarantined=True,
        )

        OfflineSyncService().reset_for_retry(state)

        state.refresh_from_db()
        self.assertFalse(state.quarantined)
        self.assertEqual(state.franchise_attempt_count, 0)
        self.assertEqual(state.attempt_count, 0)
        self.assertEqual(state.metadata_attempt_count, 1)

    def test_fully_synced_due_row_is_moved_out_of_the_queue(self):
        # Metadata and franchise are the whole pipeline (the themes stage went with Jikan).
        done = OfflineAnimeSyncState.StageStatus.SYNCED
        state = self._state(self._anime("All Done"), metadata_status=done, franchise_status=done)

        OfflineSyncService().reconcile_due(batch_size=1)

        state.refresh_from_db()
        self.assertGreater(state.next_attempt_at, timezone.now() + timedelta(days=365))

    @patch.object(OfflineSyncService, "sync_franchise_stage")
    @patch.object(OfflineSyncService, "sync_metadata_stage")
    def test_pipeline_is_complete_after_metadata_and_franchise(self, mock_metadata, mock_franchise):
        synced = StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)
        mock_metadata.return_value = synced
        mock_franchise.return_value = synced
        state = self._state(self._anime("Two Stages", anilist_id=12))
        service = OfflineSyncService()

        service.reconcile_due(batch_size=1)
        state.refresh_from_db()
        state.next_attempt_at = timezone.now() - timedelta(seconds=1)
        state.save(update_fields=["next_attempt_at"])
        result = service.reconcile_due(batch_size=1)

        state.refresh_from_db()
        mock_metadata.assert_called_once()
        mock_franchise.assert_called_once()
        self.assertEqual(state.franchise_status, OfflineAnimeSyncState.StageStatus.SYNCED)
        self.assertEqual(result["complete"], 1)
        self.assertEqual(result["pending"], 0)
        self.assertGreater(state.next_attempt_at, timezone.now() + timedelta(days=365))


class OfflineSyncResetPipelineTests(TestCase):
    _anime = OfflineSyncStatePipelineTests._anime
    _state = OfflineSyncStatePipelineTests._state

    def test_reset_pipeline_resets_every_row_except_manual_decisions(self):
        quarantined = OfflineAnimeSyncState.StageStatus.QUARANTINED
        plain = self._state(
            self._anime("Plain"),
            metadata_status=quarantined,
            quarantined=True,
            quarantine_context={"stage": "metadata", "attempts": 2},
        )
        empty_context = self._state(self._anime("Empty"), metadata_status=quarantined)
        manual = self._state(
            self._anime("Manual"),
            metadata_status=quarantined,
            quarantined=True,
            quarantine_context={"manual": True, "action": "mark_skipped"},
        )

        result = OfflineSyncService().ensure_states_for_anime_ids(
            [plain.anime_id, empty_context.anime_id, manual.anime_id], reset_pipeline=True
        )

        # Rows without a "manual" key used to be skipped too (a NULL JSON lookup).
        self.assertEqual(result["updated"], 2)
        for state in (plain, empty_context):
            state.refresh_from_db()
            self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)
            self.assertFalse(state.quarantined)
        manual.refresh_from_db()
        self.assertTrue(manual.quarantined)
