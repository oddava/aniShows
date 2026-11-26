"""Moderation queue and resolve outcomes (G6 P1-1)."""

from unittest.mock import patch

from django.test import TestCase

from ...animes.models import Anime, Review, ReviewReport
from ...core.models import AuditLog, Notification
from ..services import moderation_service
from .helpers import bearer_client, make_user

QUEUE = "/api/v1/admin/moderation/reviews/"
SUMMARY = "/api/v1/admin/moderation/summary/"


class ModerationQueueTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.staff = make_user("mod", role="staff")
        self.api = bearer_client(self.staff)
        self.anime = Anime.objects.create(
            title="Mod Anime", slug="mod-anime", synopsis="x", status="Airing", anime_type="TV"
        )
        self.author = make_user("writer")
        self.reporters = [make_user(f"reporter{index}") for index in range(3)]

    def _review(self, author=None, **fields):
        defaults = {"rating": 8, "text": "A fine review " * 30, "has_spoilers": False}
        return Review.objects.create(
            user=author or make_user(f"a{Review.objects.count()}"),
            anime=self.anime,
            **{**defaults, **fields},
        )

    def _report(self, review, reporter, reason=ReviewReport.Reason.SPAM, **fields):
        return ReviewReport.objects.create(
            review=review, reporter=reporter, reason=reason, **fields
        )

    def test_queue_lists_only_user_reported_reviews_by_default(self):
        reported = self._review(self.author)
        self._report(reported, self.reporters[0], ReviewReport.Reason.SPAM)
        self._report(reported, self.reporters[1], ReviewReport.Reason.SPOILER)
        self._review(rating=1, has_spoilers=True, text="")  # heuristics only: not a report

        response = self.api.get(QUEUE)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        row = response.data["results"][0]
        self.assertEqual(row["review_id"], reported.id)
        self.assertEqual(row["report_counts"], {"spam": 1, "spoiler": 1})
        self.assertEqual((row["report_total"], row["reporter_count"]), (2, 2))
        self.assertEqual(len(row["snippet"]), 200)
        self.assertEqual(row["author"], {"id": self.author.id, "username": "writer"})
        self.assertEqual(row["signals"], [])
        self.assertIsNotNone(row["first_reported_at"])

    def test_status_and_reason_filters(self):
        open_review = self._review()
        closed_review = self._review()
        self._report(open_review, self.reporters[0], ReviewReport.Reason.HARASSMENT)
        self._report(closed_review, self.reporters[0], status=ReviewReport.Status.DISMISSED)

        harassment = self.api.get(QUEUE, {"reason": "harassment"}).data
        dismissed = self.api.get(QUEUE, {"status": "dismissed"}).data
        spam_only = self.api.get(QUEUE, {"reason": "spam"}).data

        self.assertEqual([row["review_id"] for row in harassment["results"]], [open_review.id])
        self.assertEqual([row["review_id"] for row in dismissed["results"]], [closed_review.id])
        self.assertEqual(spam_only["count"], 0)
        self.assertEqual(self.api.get(QUEUE, {"status": "bogus"}).status_code, 400)
        self.assertEqual(self.api.get(QUEUE, {"reason": "bogus"}).status_code, 400)

    def test_signals_view_is_opt_in(self):
        flagged = self._review(rating=2, has_spoilers=True, text="")
        self._review(rating=9)

        rows = self.api.get(QUEUE, {"signals": "1"}).data["results"]

        self.assertEqual([row["review_id"] for row in rows], [flagged.id])
        self.assertEqual(rows[0]["signals"], ["low_rating", "spoiler_tag", "empty_text"])
        self.assertEqual(rows[0]["report_total"], 0)

    def test_summary_counts_match_the_queue(self):
        first, second = self._review(), self._review()
        self._report(first, self.reporters[0], ReviewReport.Reason.SPAM)
        self._report(first, self.reporters[1], ReviewReport.Reason.SPAM)
        self._report(second, self.reporters[2], ReviewReport.Reason.OTHER)
        self._report(self._review(), self.reporters[0], status=ReviewReport.Status.RESOLVED)

        summary = self.api.get(SUMMARY).data
        queue = self.api.get(QUEUE).data

        self.assertEqual(summary["open_reviews"], queue["count"])
        self.assertEqual(summary["open_reports"], 3)
        self.assertEqual(summary["by_reason"], {"spam": 2, "other": 1})
        self.assertIsNone(summary["forums"])

    def test_forum_endpoints_are_404_until_g5_ships_forum_reports(self):
        # apps.forums.services.moderation exists (G5's lock/remove helpers) but
        # does not implement list_open_reports/resolve_reports/open_count.
        self.assertEqual(self.api.get("/api/v1/admin/moderation/forums/").status_code, 404)
        response = self.api.post(
            "/api/v1/admin/moderation/forums/5/resolve/", {"outcome": "dismiss"}, format="json"
        )
        self.assertEqual(response.status_code, 404)


class ModerationResolveTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.staff = make_user("resolver", role="staff")
        self.api = bearer_client(self.staff)
        anime = Anime.objects.create(
            title="Res Anime", slug="res-anime", synopsis="x", status="Airing", anime_type="TV"
        )
        self.review = Review.objects.create(
            user=make_user("res-author"), anime=anime, rating=6, text="Spoilers ahead"
        )
        self.reports = [
            ReviewReport.objects.create(
                review=self.review, reporter=make_user(f"r{index}"), reason="spoiler"
            )
            for index in range(2)
        ]
        ReviewReport.objects.filter(pk=self.reports[1].pk).update(status="in_review")

    def _resolve(self, outcome, **extra):
        return self.api.post(
            f"/api/v1/admin/moderation/reviews/{self.review.id}/resolve/",
            {"outcome": outcome, **extra},
            format="json",
        )

    def test_dismiss_closes_reports_and_keeps_the_review(self):
        response = self._resolve("dismiss", notes="Not a spoiler")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["reports_updated"], 2)
        self.assertEqual(
            set(ReviewReport.objects.values_list("status", "resolved_by", "resolution_notes")),
            {("dismissed", self.staff.id, "Not a spoiler")},
        )
        self.review.refresh_from_db()
        self.assertFalse(self.review.has_spoilers)
        self.assertEqual(AuditLog.objects.get().action, AuditLog.ActionType.DISMISS)

    def test_mark_spoiler_resolves_and_flags(self):
        response = self._resolve("mark_spoiler")

        self.assertEqual(response.status_code, 200)
        self.review.refresh_from_db()
        self.assertTrue(self.review.has_spoilers)
        self.assertEqual(set(ReviewReport.objects.values_list("status", flat=True)), {"resolved"})
        row = AuditLog.objects.get()
        self.assertEqual(row.action, AuditLog.ActionType.RESOLVE)
        self.assertEqual(row.changes, {"has_spoilers": {"old": False, "new": True}})

    def test_remove_review_deletes_through_the_model(self):
        self.assertEqual(
            self._resolve("remove_review").status_code, 400
        )  # the author sees a reason
        with (
            patch.object(Review, "delete", autospec=True, side_effect=Review.delete) as delete,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self._resolve("remove_review", notes="Spoils the ending")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["review_deleted"])
        delete.assert_called_once()
        self.assertFalse(Review.objects.filter(pk=self.review.pk).exists())
        row = AuditLog.objects.get()
        self.assertEqual(
            (row.action, row.entity_id), (AuditLog.ActionType.RESOLVE, str(self.review.id))
        )
        self.assertEqual(row.metadata["report_reasons"], {"spoiler": 2})
        notice = Notification.objects.get(user=self.review.user)
        self.assertIn("was removed", notice.title)
        self.assertIn("Spoils the ending", notice.message)

    def test_outcome_is_atomic(self):
        with patch.object(moderation_service, "record_admin_action", side_effect=RuntimeError):
            try:
                response = self._resolve("mark_spoiler")
            except RuntimeError:  # the test client re-raises unhandled view errors
                response = None
        if response is not None:
            self.assertEqual(response.status_code, 500)

        self.review.refresh_from_db()
        self.assertFalse(self.review.has_spoilers)
        self.assertEqual(ReviewReport.objects.filter(status__in=["open", "in_review"]).count(), 2)

    def test_bad_input(self):
        self.assertEqual(self._resolve("ban_everyone").status_code, 400)
        self.assertEqual(self._resolve("dismiss", notes="x" * 1001).status_code, 400)
        for bad_id in ("abc", "1e3"):
            for url in (
                f"/api/v1/admin/moderation/reviews/{bad_id}/resolve/",
                f"/api/v1/admin/reviews/{bad_id}/reports/resolve/",
            ):
                with self.subTest(url=url):
                    self.assertEqual(
                        self.api.post(url, {"outcome": "dismiss"}, format="json").status_code, 404
                    )
        missing = self.api.post(
            "/api/v1/admin/moderation/reviews/999999/resolve/",
            {"outcome": "dismiss"},
            format="json",
        )
        self.assertEqual(missing.status_code, 404)

    def test_nothing_open_is_a_conflict(self):
        self._resolve("dismiss")
        self.assertEqual(self._resolve("dismiss").status_code, 409)
        self.assertEqual(AuditLog.objects.count(), 1)

    def test_regular_users_cannot_moderate(self):
        response = bearer_client(make_user("nobody")).post(
            f"/api/v1/admin/moderation/reviews/{self.review.id}/resolve/",
            {"outcome": "dismiss"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
