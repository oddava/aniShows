"""Suspend and restore with a reason (G6 P1-2)."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connection
from django.test import RequestFactory, TestCase, TransactionTestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ...core.models import AuditLog
from ..services import user_admin_service
from ..services.user_admin_service import AdminUserActionError, suspend_user
from .helpers import bearer_client, make_user

User = get_user_model()


def _url(user, action):
    return f"/api/v1/admin/users/{user.id}/{action}/"


class UserSuspensionTests(TestCase):
    def setUp(self):
        self.staff = make_user("mod", role="staff")
        self.root = make_user("root", role="superuser")
        self.target = make_user("member")
        self.staff_client = bearer_client(self.staff)

    def _suspend(self, client, user, reason="Repeated spam"):
        return client.post(_url(user, "suspend"), {"reason": reason}, format="json")

    def test_reason_is_required(self):
        for payload in ({}, {"reason": "  "}, {"reason": "no"}, {"reason": "x" * 501}):
            with self.subTest(payload=payload):
                response = self.staff_client.post(
                    _url(self.target, "suspend"), payload, format="json"
                )
                self.assertEqual(response.status_code, 400)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)

    def test_suspend_is_idempotent_and_audited_once(self):
        first = self._suspend(self.staff_client, self.target)
        second = self._suspend(self.staff_client, self.target)

        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data["changed"])
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data["changed"])
        self.target.refresh_from_db()
        self.assertFalse(self.target.is_active)
        row = AuditLog.objects.get()
        self.assertEqual(
            (row.action, row.metadata["reason"]), (AuditLog.ActionType.SUSPEND, "Repeated spam")
        )

    def test_suspend_blacklists_refresh_tokens_and_kills_access_tokens(self):
        refresh = RefreshToken.for_user(self.target)
        member = bearer_client(self.target)
        self.assertEqual(member.get("/api/v1/users/me/").status_code, 200)

        self._suspend(self.staff_client, self.target)

        outstanding = OutstandingToken.objects.get(jti=refresh["jti"])
        self.assertTrue(BlacklistedToken.objects.filter(token=outstanding).exists())
        self.assertEqual(member.get("/api/v1/users/me/").status_code, 401)

    def test_refusals(self):
        other_staff = make_user("mod2", role="staff")
        self.assertEqual(self._suspend(self.staff_client, self.staff).status_code, 400)  # self
        self.assertEqual(self._suspend(self.staff_client, self.root).status_code, 403)
        self.assertEqual(self._suspend(self.staff_client, other_staff).status_code, 403)
        root_client = bearer_client(self.root)
        self.assertEqual(self._suspend(root_client, other_staff).status_code, 200)
        self.assertEqual(self._suspend(root_client, self.root).status_code, 400)
        self.assertEqual(AuditLog.objects.count(), 1)

    def test_restore_reverses_and_history_shows_in_user_detail(self):
        self._suspend(self.staff_client, self.target)
        restored = self.staff_client.post(
            _url(self.target, "restore"), {"reason": "Appeal accepted"}, format="json"
        )

        self.assertEqual(restored.status_code, 200)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)

        detail = self.staff_client.get(f"/api/v1/admin/users/{self.target.id}/").data
        history = detail["moderation_history"]
        self.assertEqual([entry["action"] for entry in history], ["RESTORE", "SUSPEND"])
        self.assertEqual(history[0]["reason"], "Appeal accepted")
        self.assertEqual(history[1]["actor"], "mod")

    def test_bulk_ban_needs_a_reason_skips_staff_and_shows_in_history(self):
        other = make_user("member2")
        other_staff = make_user("mod3", role="staff")
        root_client = bearer_client(self.root)
        payload = {
            "operation": "ban",
            "entity_type": "user",
            "entity_ids": [self.target.id, other.id, other_staff.id],
        }

        self.assertEqual(
            root_client.post("/api/v1/admin/bulk/", payload, format="json").status_code, 400
        )
        response = root_client.post(
            "/api/v1/admin/bulk/", {**payload, "reason": "Spam ring"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated"], 2)
        other_staff.refresh_from_db()
        self.assertTrue(other_staff.is_active)
        history = self.staff_client.get(f"/api/v1/admin/users/{other.id}/").data[
            "moderation_history"
        ]
        self.assertEqual(
            [(entry["action"], entry["reason"]) for entry in history],
            [("BULK_ACTION", "Spam ring")],
        )
        skipped = self.staff_client.get(f"/api/v1/admin/users/{other_staff.id}/").data
        self.assertEqual(skipped["moderation_history"], [])


class SuspensionUsesCurrentStateTests(TestCase):
    """The service re-reads the target under a lock (council round 2)."""

    def test_a_target_promoted_after_it_was_loaded_is_refused(self):
        moderator = make_user("mod-stale", role="staff")
        stale = make_user("soon-staff")
        User.objects.filter(pk=stale.pk).update(is_staff=True)  # a superuser promotes them
        request = RequestFactory().post("/api/v1/admin/users/x/suspend/")
        request.user = moderator

        with self.assertRaises(AdminUserActionError) as refused:
            suspend_user(request, stale, "Too late")

        self.assertEqual(refused.exception.status_code, 403)
        self.assertTrue(User.objects.get(pk=stale.pk).is_active)

    def test_a_repeat_on_a_stale_object_reports_no_change(self):
        moderator = make_user("mod-repeat", role="staff")
        target = make_user("already-out")
        User.objects.filter(pk=target.pk).update(is_active=False)
        request = RequestFactory().post("/api/v1/admin/users/x/suspend/")
        request.user = moderator

        result = suspend_user(request, target, "Again")

        self.assertFalse(result.payload["changed"])
        self.assertFalse(AuditLog.objects.exists())


class SuspensionIsAtomicTests(TransactionTestCase):
    """Lock, checks, change, session revoke and audit row are one transaction (round 3)."""

    def _request(self, actor):
        request = RequestFactory().post("/api/v1/admin/users/x/suspend/")
        request.user = actor
        return request

    def test_a_failed_audit_row_rolls_the_suspension_back(self):
        moderator = make_user("mod-rollback", role="staff")
        target = make_user("keep-me")
        refresh = RefreshToken.for_user(target)
        with (
            patch.object(user_admin_service, "record_admin_action", side_effect=DatabaseError),
            self.assertRaises(DatabaseError),
        ):
            suspend_user(self._request(moderator), target, "Spam account")

        self.assertTrue(User.objects.get(pk=target.pk).is_active)
        outstanding = OutstandingToken.objects.get(jti=refresh["jti"])
        self.assertFalse(BlacklistedToken.objects.filter(token=outstanding).exists())

    def test_checks_run_while_the_row_lock_is_held(self):
        moderator = make_user("mod-atomic", role="staff")
        target = make_user("locked-target")
        seen = {}
        real_check = user_admin_service.check_can_moderate

        def check(target_user, actor):
            seen["atomic"] = connection.in_atomic_block
            real_check(target_user, actor)

        with patch.object(user_admin_service, "check_can_moderate", side_effect=check):
            suspend_user(self._request(moderator), target, "Spam account")

        self.assertEqual(seen, {"atomic": True})
