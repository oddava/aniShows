"""Suspend and restore with a reason (G6 P1-2)."""

from django.test import TestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ...core.models import AuditLog
from .helpers import bearer_client, make_user


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
