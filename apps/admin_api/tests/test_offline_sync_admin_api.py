from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from ...animes.models import Anime, OfflineAnimeSyncState

User = get_user_model()


class OfflineSyncAdminAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="offline-admin",
            email="offline-admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.client.force_authenticate(self.admin)

    def _anime(self, title: str, **overrides):
        payload = {
            "title": title,
            "slug": title.lower().replace(" ", "-"),
            "synopsis": "offline",
            "anime_type": Anime.AnimeType.tv,
            "status": Anime.AnimeStatus.finished,
            "offline_db_last_seen_at": timezone.now(),
        }
        payload.update(overrides)
        return Anime.objects.create(**payload)

    def _state(self, anime: Anime, **overrides):
        payload = {
            "anime": anime,
            "metadata_status": OfflineAnimeSyncState.StageStatus.QUARANTINED,
            "franchise_status": OfflineAnimeSyncState.StageStatus.PENDING,
            "themes_status": OfflineAnimeSyncState.StageStatus.PENDING,
            "quarantined": True,
            "quarantine_reason": "identity_conflict",
            "next_attempt_at": timezone.now() + timedelta(days=1),
        }
        payload.update(overrides)
        return OfflineAnimeSyncState.objects.create(**payload)

    def test_list_defaults_to_quarantined_records(self):
        quarantined = self._state(self._anime("Quarantined"))
        self._state(
            self._anime("Active"),
            quarantined=False,
            metadata_status=OfflineAnimeSyncState.StageStatus.PENDING,
            quarantine_reason="",
        )

        response = self.client.get("/api/v1/admin/offline-sync-states/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], quarantined.id)

    def test_retry_action_resets_quarantine(self):
        state = self._state(self._anime("Retry Me"))

        response = self.client.post(f"/api/v1/admin/offline-sync-states/{state.id}/retry/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        state.refresh_from_db()
        self.assertFalse(state.quarantined)
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)
        self.assertEqual(state.last_error_code, "")

    def test_mark_skipped_action_sets_manual_reason(self):
        state = self._state(self._anime("Skip Me"))

        response = self.client.post(
            f"/api/v1/admin/offline-sync-states/{state.id}/mark_skipped/",
            {"reason": "operator_skipped"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        state.refresh_from_db()
        self.assertTrue(state.quarantined)
        self.assertEqual(state.quarantine_reason, "operator_skipped")

    def test_set_ids_and_retry_updates_identity_then_resets(self):
        state = self._state(self._anime("Set IDs"))

        response = self.client.post(
            f"/api/v1/admin/offline-sync-states/{state.id}/set_ids_and_retry/",
            {"anilist_id": 12345, "mal_id": 67890},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        state.refresh_from_db()
        state.anime.refresh_from_db()
        self.assertEqual(state.anime.anilist_id, 12345)
        self.assertEqual(state.anime.mal_id, 67890)
        self.assertFalse(state.quarantined)
        self.assertEqual(state.metadata_status, OfflineAnimeSyncState.StageStatus.PENDING)

    def test_merge_target_marks_record_as_skipped_merge(self):
        source_state = self._state(self._anime("Merge Source"))
        target = self._anime("Merge Target")

        response = self.client.post(
            f"/api/v1/admin/offline-sync-states/{source_state.id}/merge_target/",
            {"target_anime_id": target.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        source_state.refresh_from_db()
        self.assertTrue(source_state.quarantined)
        self.assertEqual(source_state.quarantine_reason, f"merged_into:{target.id}")
