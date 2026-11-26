"""Bulk-operation safety rails (G6 P1-4)."""

from contextlib import suppress
from unittest.mock import patch

from django.test import TestCase

from ...animes.models import Anime, Review, UserFavorite
from ...core.models import AuditLog
from ..services.bulk_operations_service import MAX_BULK_IDS
from .helpers import bearer_client, make_user

URL = "/api/v1/admin/bulk/"


class BulkOperationTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.request_hydrate", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.api = bearer_client(make_user("bulk-root", role="superuser"))
        self.anime = [
            Anime.objects.create(
                title=f"Bulk {index}",
                slug=f"bulk-{index}",
                synopsis="x",
                status="Airing",
                anime_type="TV",
            )
            for index in range(2)
        ]
        fan = make_user("fan")
        Review.objects.create(user=fan, anime=self.anime[0], rating=7, text="ok")
        UserFavorite.objects.create(user=fan, anime=self.anime[0])

    def _post(self, **payload):
        return self.api.post(
            URL,
            {"operation": "delete", "entity_type": "anime", **payload},
            format="json",
        )

    def test_id_validation(self):
        too_many = self._post(entity_ids=list(range(1, MAX_BULK_IDS + 2)))
        not_ints = self._post(entity_ids=["x"])
        negative = self._post(entity_ids=[-1])
        floats = self._post(entity_ids=[1.5])
        empty = self._post(entity_ids=[])

        for response in (too_many, not_ints, negative, floats, empty):
            self.assertEqual(response.status_code, 400)
        self.assertEqual(Anime.objects.count(), 2)

    def test_dry_run_counts_cascades_and_deletes_nothing(self):
        response = self._post(entity_ids=[anime.id for anime in self.anime], dry_run=True)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["dry_run"])
        self.assertEqual(response.data["matched"], 2)
        counts = response.data["would_delete_by_model"]
        self.assertEqual(counts["anime.Anime"], 2)
        self.assertEqual(counts["anime.Review"], 1)
        self.assertEqual(counts["anime.UserFavorite"], 1)
        self.assertEqual(Anime.objects.count(), 2)
        self.assertFalse(AuditLog.objects.exists())

    def test_delete_needs_the_matched_count_as_confirm(self):
        ids = [anime.id for anime in self.anime]

        missing = self._post(entity_ids=ids)
        wrong = self._post(entity_ids=ids, confirm="3")
        right = self._post(entity_ids=ids, confirm="2")

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.data["matched"], 2)
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(right.status_code, 200)
        self.assertEqual(right.data["deleted_by_model"]["anime.Anime"], 2)
        self.assertEqual(right.data["message"], "Deleted 2 anime.")  # not cascades
        self.assertEqual(Anime.objects.count(), 0)
        self.assertEqual(AuditLog.objects.get().action, AuditLog.ActionType.BULK_ACTION)

    def test_user_ban_dry_run_previews_without_changing_anyone(self):
        member = make_user("dry-member")
        response = self.api.post(
            URL,
            {
                "operation": "ban",
                "entity_type": "user",
                "entity_ids": [member.id],
                "reason": "Spam ring",
                "dry_run": True,
            },
            format="json",
        )

        self.assertEqual((response.status_code, response.data["matched"]), (200, 1))
        member.refresh_from_db()
        self.assertTrue(member.is_active)
        self.assertFalse(AuditLog.objects.exists())

    def test_anime_update_status_is_gone(self):
        response = self.api.post(
            URL,
            {
                "operation": "update_status",
                "entity_type": "anime",
                "entity_ids": [self.anime[0].id],
                "status": "Finished",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_failure_rolls_back(self):
        ids = [anime.id for anime in self.anime]
        with (
            patch(
                "apps.admin_api.services.bulk_operations_service.record_admin_action",
                side_effect=RuntimeError,
            ),
            suppress(RuntimeError),  # the test client re-raises unhandled view errors
        ):
            self._post(entity_ids=ids, confirm="2")
        self.assertEqual(Anime.objects.count(), 2)

    def test_reviews_are_deleted_through_the_model(self):
        review = Review.objects.get()
        with patch.object(Review, "delete", autospec=True, side_effect=Review.delete) as delete:
            response = self.api.post(
                URL,
                {
                    "operation": "delete",
                    "entity_type": "reviews",
                    "entity_ids": [review.id],
                    "confirm": "1",
                    "reason": "Spam wave",
                },
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        delete.assert_called_once()
