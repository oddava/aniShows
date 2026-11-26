"""Admin mutations made with a real Bearer token are audited exactly once (G6 P0-1)."""

from contextlib import suppress
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, TestCase

from ...animes.models import Anime, Genre, Review, ReviewReport
from ...core import utils as core_utils
from ...core.middleware.logging_middleware import AdminAuditMiddleware
from ...core.models import AuditLog
from ...users.models import Badge
from ..services.audit import mark_audited
from .helpers import bearer_client, make_user

PROXY = "10.0.0.2"
CLIENT_IP = "203.0.113.50"


class AdminAuditTrailTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.request_hydrate", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Requests arrive through one trusted proxy, as behind Caddy.
        env = patch.dict("os.environ", {"TRUSTED_PROXY_CIDRS": "10.0.0.0/8"})
        env.start()
        self.addCleanup(env.stop)
        core_utils._trusted_proxy_networks.cache_clear()
        self.addCleanup(core_utils._trusted_proxy_networks.cache_clear)

        self.staff = make_user("auditor", role="staff")
        self.root = make_user("auditroot", role="superuser")
        self.target = make_user("target")
        self.anime = Anime.objects.create(
            title="Audit Anime", slug="audit-anime", synopsis="x", status="Airing", anime_type="TV"
        )

    def _client(self, user):
        return bearer_client(user, REMOTE_ADDR=PROXY, HTTP_X_FORWARDED_FOR=CLIENT_IP)

    def _only_row(self):
        rows = list(AuditLog.objects.all())
        self.assertEqual(len(rows), 1, [(row.action, row.entity_repr) for row in rows])
        return rows[0]

    def test_suspend_is_attributed_to_the_jwt_user_and_real_ip(self):
        response = self._client(self.staff).post(
            f"/api/v1/admin/users/{self.target.id}/suspend/", {"reason": "Spam"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        row = self._only_row()
        self.assertEqual(
            (row.user, row.user_ip, row.action, row.entity_type, row.entity_id),
            (self.staff, CLIENT_IP, AuditLog.ActionType.SUSPEND, "User", str(self.target.id)),
        )
        self.assertEqual(row.metadata["reason"], "Spam")

    def test_toggle_staff_and_delete_user(self):
        client = self._client(self.root)
        client.post(
            f"/api/v1/admin/users/{self.target.id}/toggle_staff/", {"is_staff": True}, format="json"
        )
        self.assertEqual(self._only_row().changes, {"is_staff": {"old": False, "new": True}})

        AuditLog.objects.all().delete()
        response = client.delete(f"/api/v1/admin/users/{self.target.id}/")
        self.assertEqual(response.status_code, 200)
        row = self._only_row()
        self.assertEqual((row.action, row.entity_repr), (AuditLog.ActionType.DELETE, "target"))

    def test_review_delete_and_moderation_resolve(self):
        author = make_user("author")
        review = Review.objects.create(user=author, anime=self.anime, rating=7, text="t")
        reported = Review.objects.create(user=self.target, anime=self.anime, rating=2, text="s")
        ReviewReport.objects.create(review=reported, reporter=author, reason="spam")
        client = self._client(self.staff)

        url = f"/api/v1/admin/reviews/{review.id}/"
        self.assertEqual(client.delete(url).status_code, 400)  # a reason is required
        self.assertEqual(
            client.delete(url, {"reason": "Spam links"}, format="json").status_code, 200
        )
        row = self._only_row()
        self.assertEqual(
            (row.action, row.metadata.get("reason")), (AuditLog.ActionType.DELETE, "Spam links")
        )

        AuditLog.objects.all().delete()
        response = client.post(
            f"/api/v1/admin/moderation/reviews/{reported.id}/resolve/",
            {"outcome": "dismiss"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._only_row().action, AuditLog.ActionType.DISMISS)

    def test_catalog_create_update_delete_record_changed_fields(self):
        client = self._client(self.root)

        created = client.post(
            "/api/v1/admin/genres/", {"name": "Slice", "slug": "slice"}, format="json"
        )
        self.assertEqual(created.status_code, 201)
        row = self._only_row()
        self.assertEqual((row.action, row.entity_type), (AuditLog.ActionType.CREATE, "Genre"))
        self.assertEqual(row.new_state["name"], "Slice")

        genre_id = created.data["id"]
        AuditLog.objects.all().delete()
        client.patch(f"/api/v1/admin/genres/{genre_id}/", {"name": "Slice of Life"}, format="json")
        self.assertEqual(
            self._only_row().changes, {"name": {"old": "Slice", "new": "Slice of Life"}}
        )

        AuditLog.objects.all().delete()
        self.assertEqual(client.delete(f"/api/v1/admin/genres/{genre_id}/").status_code, 200)
        self.assertEqual(self._only_row().action, AuditLog.ActionType.DELETE)

    def test_blocked_genre_delete_writes_no_row(self):
        genre = Genre.objects.create(name="Used", slug="used")
        self.anime.genres.add(genre)

        response = self._client(self.root).delete(f"/api/v1/admin/genres/{genre.id}/")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(AuditLog.objects.exists())

    def test_failed_delete_leaves_no_audit_row(self):
        genre = Genre.objects.create(name="Doomed", slug="doomed")
        with (
            patch.object(Genre, "delete", side_effect=DatabaseError("boom")),
            suppress(DatabaseError),  # the test client re-raises unhandled view errors
        ):
            self._client(self.root).delete(f"/api/v1/admin/genres/{genre.id}/")

        self.assertFalse(AuditLog.objects.exists())
        self.assertTrue(Genre.objects.filter(pk=genre.pk).exists())

    def test_bulk_operation_writes_one_row(self):
        other = Anime.objects.create(
            title="Audit Two", slug="audit-two", synopsis="x", status="Airing", anime_type="TV"
        )
        response = self._client(self.root).post(
            "/api/v1/admin/bulk/",
            {
                "operation": "delete",
                "entity_type": "anime",
                "entity_ids": [self.anime.id, other.id],
                "confirm": "2",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        row = self._only_row()
        self.assertEqual(row.action, AuditLog.ActionType.BULK_ACTION)
        self.assertEqual(row.metadata["ids"], sorted([self.anime.id, other.id]))

    def test_badge_create_update_and_grant(self):
        client = self._client(self.root)
        created = client.post(
            "/api/v1/admin/badges/",
            {"name": "Helper", "description": "Helps", "icon": "star", "color": "#7c3aed"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self._only_row().action, AuditLog.ActionType.CREATE)

        badge = Badge.objects.get(pk=created.data["id"])
        AuditLog.objects.all().delete()
        client.patch(f"/api/v1/admin/badges/{badge.id}/", {"name": "Guide"}, format="json")
        row = self._only_row()
        self.assertEqual((row.action, row.user_ip), (AuditLog.ActionType.UPDATE, CLIENT_IP))

        AuditLog.objects.all().delete()
        granted = client.post(
            f"/api/v1/admin/badges/{badge.id}/grant/",
            {"user_ids": [self.target.id], "reason": "Thanks"},
            format="json",
        )
        self.assertEqual(granted.status_code, 200)
        row = self._only_row()
        self.assertEqual(row.metadata["user_ids"], [self.target.id])

    @patch("apps.animes.tasks.catalog.run_catalog_lane.apply_async")
    def test_catalog_lane_trigger(self, apply_async):
        apply_async.return_value = SimpleNamespace(id="audit-task")

        response = self._client(self.root).post(
            "/api/v1/admin/catalog/lanes/trending/run/", {}, format="json"
        )

        self.assertEqual(response.status_code, 202)
        row = self._only_row()
        self.assertEqual(row.action, AuditLog.ActionType.TRIGGER)
        self.assertEqual(row.entity_type, "CatalogLane")
        apply_async.assert_called_once()
        self.assertEqual(apply_async.call_args.kwargs["queue"], "high_priority")

    def test_failed_requests_write_nothing(self):
        client = self._client(self.staff)
        client.post(f"/api/v1/admin/users/{self.target.id}/suspend/", {}, format="json")  # 400
        client.post(f"/api/v1/admin/users/{self.root.id}/suspend/", {"reason": "x" * 5})  # 403
        client.delete(f"/api/v1/admin/anime/{self.anime.id}/")  # 403 for staff

        self.assertFalse(AuditLog.objects.exists())


class AdminAuditMiddlewareFallbackTests(TestCase):
    def setUp(self):
        self.staff = make_user("fallback-staff", role="staff")
        self.factory = RequestFactory()

    def _run(self, request, status_code=200):
        middleware = AdminAuditMiddleware(lambda req: SimpleNamespace(status_code=status_code))
        return middleware(request)

    def test_unaudited_admin_mutation_gets_one_generic_row(self):
        request = self.factory.post("/api/v1/admin/genres/12/", REMOTE_ADDR="198.51.100.4")
        request.user = self.staff

        self._run(request)

        row = AuditLog.objects.get()
        self.assertEqual(
            (row.user, row.action, row.entity_type, row.entity_id, row.metadata["fallback"]),
            (self.staff, AuditLog.ActionType.CREATE, "Genre", "12", True),
        )

    def test_audited_request_is_not_written_twice(self):
        request = self.factory.post("/api/v1/admin/genres/12/")
        request.user = self.staff
        mark_audited(request)  # what record_admin_action leaves behind

        self._run(request)

        self.assertFalse(AuditLog.objects.exists())

    def test_reads_failures_and_non_admin_paths_are_skipped(self):
        for request, code in (
            (self.factory.get("/api/v1/admin/genres/"), 200),
            (self.factory.post("/api/v1/admin/genres/"), 400),
            (self.factory.post("/api/v1/reviews/"), 201),
        ):
            request.user = self.staff
            self._run(request, code)

        self.assertFalse(AuditLog.objects.exists())

    def test_user_is_read_after_the_view(self):
        """DRF sets ``request.user`` for JWT requests during the view."""
        request = self.factory.delete("/api/v1/admin/studios/3/")

        def view(req):
            req.user = self.staff
            return SimpleNamespace(status_code=200)

        AdminAuditMiddleware(view)(request)

        self.assertEqual(AuditLog.objects.get().user, self.staff)
