"""User page extras: detail sections, sign-out, verify email, reset link, clear profile, CSV."""

import csv
import io
from datetime import UTC
from unittest.mock import patch

from django.test import TestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from ...animes.models import Anime, Review
from ...core.models import AuditLog
from ...forums.models import Category, Thread
from ...users.models import UserAnimeList, UserProfile
from .helpers import bearer_client, make_user


def _url(user, action=""):
    return f"/api/v1/admin/users/{user.id}/{action + '/' if action else ''}"


class UserToolsTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.staff = make_user("mod", role="staff")
        self.root = make_user("root", role="superuser")
        self.member = make_user("member")
        self.staff_client = bearer_client(self.staff)
        self.root_client = bearer_client(self.root)

    def test_detail_has_every_section(self):
        anime = Anime.objects.create(
            title="Detail", slug="detail", synopsis="x", status="Airing", anime_type="TV"
        )
        Review.objects.create(user=self.member, anime=anime, rating=8, text="Great")
        UserAnimeList.objects.create(user=self.member, anime=anime, status="Watching")
        category = Category.objects.create(name="General", slug="general")
        Thread.objects.create(category=category, author=self.member, title="Hi", content="x")

        response = self.staff_client.get(_url(self.member))

        self.assertEqual(response.status_code, 200)
        data = response.data
        for key in (
            "profile",
            "stats",
            "list_breakdown",
            "recent_reviews",
            "recent_threads",
            "badges",
            "auth_providers",
            "moderation_history",
        ):
            self.assertIn(key, data)
        self.assertEqual(data["stats"]["reviews"], 1)
        self.assertEqual(data["stats"]["forum_threads"], 1)
        self.assertEqual(data["list_breakdown"], {"Watching": 1})
        self.assertEqual(data["recent_reviews"][0]["anime"]["slug"], "detail")
        self.assertEqual(data["recent_threads"][0]["title"], "Hi")

    def test_new_filters(self):
        UserProfile.objects.filter(user__in=[self.staff, self.root]).update(email_verified=False)
        UserProfile.objects.update_or_create(user=self.member, defaults={"email_verified": True})
        response = self.staff_client.get("/api/v1/admin/users/?email_verified=true")
        self.assertEqual([row["username"] for row in response.data["results"]], ["member"])
        response = self.staff_client.get("/api/v1/admin/users/?is_superuser=true")
        self.assertEqual([row["username"] for row in response.data["results"]], ["root"])
        response = self.staff_client.get("/api/v1/admin/users/?joined_after=2000-01-01")
        self.assertEqual(response.data["count"], 3)

    def test_revoke_sessions_blacklists_tokens_and_audits(self):
        RefreshToken.for_user(self.member)
        response = self.staff_client.post(_url(self.member, "revoke_sessions"))

        self.assertEqual(response.status_code, 200)
        outstanding = OutstandingToken.objects.filter(user=self.member).count()
        self.assertEqual(
            BlacklistedToken.objects.filter(token__user=self.member).count(), outstanding
        )
        row = AuditLog.objects.get()
        self.assertEqual((row.action, row.entity_id), ("CONTROL", str(self.member.id)))

    def test_staff_cannot_revoke_staff_or_self(self):
        other_staff = make_user("mod2", role="staff")
        self.assertEqual(
            self.staff_client.post(_url(other_staff, "revoke_sessions")).status_code, 403
        )
        self.assertEqual(
            self.staff_client.post(_url(self.staff, "revoke_sessions")).status_code, 400
        )
        self.assertFalse(AuditLog.objects.exists())

    def test_verify_email_is_superuser_only_and_idempotent(self):
        self.assertEqual(self.staff_client.post(_url(self.member, "verify_email")).status_code, 403)
        first = self.root_client.post(_url(self.member, "verify_email"))
        second = self.root_client.post(_url(self.member, "verify_email"))

        self.assertEqual((first.data["changed"], second.data["changed"]), (True, False))
        self.assertTrue(UserProfile.objects.get(user=self.member).email_verified)
        self.assertEqual(AuditLog.objects.count(), 1)

    def test_send_password_reset(self):
        with patch(
            "apps.users.services.email_service.EmailService.send_password_reset_email"
        ) as send:
            response = self.staff_client.post(_url(self.member, "send_password_reset"))
        self.assertEqual(response.status_code, 200)
        send.assert_called_once()
        self.assertEqual(AuditLog.objects.get().action, "TRIGGER")

        self.member.is_active = False
        self.member.save(update_fields=["is_active"])
        with patch("apps.users.services.email_service.EmailService.send_password_reset_email"):
            refused = self.staff_client.post(_url(self.member, "send_password_reset"))
        self.assertEqual(refused.status_code, 400)

    def test_password_reset_respects_moderation_rules_and_a_cooldown(self):
        target = "apps.users.services.email_service.EmailService.send_password_reset_email"
        with patch(target) as send:
            to_superuser = self.staff_client.post(_url(self.root, "send_password_reset"))
            to_self = self.staff_client.post(_url(self.staff, "send_password_reset"))
            first = self.root_client.post(_url(self.member, "send_password_reset"))
            again = self.root_client.post(_url(self.member, "send_password_reset"))
        self.assertEqual(to_superuser.status_code, 403)
        self.assertEqual(to_self.status_code, 400)
        self.assertEqual((first.status_code, again.status_code), (200, 429))
        send.assert_called_once()

    def test_password_reset_reports_a_queue_outage(self):
        from kombu.exceptions import OperationalError

        target = "apps.users.services.email_service.EmailService.send_password_reset_email"
        with patch(target, side_effect=OperationalError("broker down")):
            response = self.staff_client.post(_url(self.member, "send_password_reset"))
        self.assertEqual(response.status_code, 503)
        self.assertFalse(AuditLog.objects.exists())

    def test_clear_profile(self):
        UserProfile.objects.update_or_create(user=self.member, defaults={"bio": "rude words"})
        url = _url(self.member, "clear_profile")

        self.assertEqual(
            self.staff_client.post(url, {"fields": ["bio"]}, format="json").status_code, 400
        )
        self.assertEqual(
            self.staff_client.post(
                url, {"fields": ["nope"], "reason": "Offensive"}, format="json"
            ).status_code,
            400,
        )
        response = self.staff_client.post(
            url, {"fields": ["bio", "avatar"], "reason": "Offensive"}, format="json"
        )
        repeat = self.staff_client.post(
            url, {"fields": ["bio"], "reason": "Offensive"}, format="json"
        )

        self.assertEqual(response.data["cleared"], ["bio"])
        self.assertEqual(repeat.data["cleared"], [])
        self.assertEqual(UserProfile.objects.get(user=self.member).bio, "")
        row = AuditLog.objects.get()
        self.assertEqual(row.metadata["reason"], "Offensive")
        self.assertEqual(row.previous_state, {"bio": "rude words"})

    def test_export_is_superuser_only_csv_and_neutralises_formulas(self):
        make_user("=HYPERLINK")
        self.assertEqual(self.staff_client.get("/api/v1/admin/users/export/").status_code, 403)

        response = self.root_client.get("/api/v1/admin/users/export/?ordering=username")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        self.assertEqual(rows[0][:3], ["id", "username", "email"])
        usernames = [row[1] for row in rows[1:]]
        self.assertIn("'=HYPERLINK", usernames)
        self.assertEqual(len(rows) - 1, 4)
        row = AuditLog.objects.get()
        self.assertEqual((row.action, row.metadata["rows"]), ("EXPORT", 4))


class JoinedSinceFilterTests(TestCase):
    def test_a_local_day_boundary_with_its_offset(self):
        from datetime import datetime

        client = bearer_client(make_user("joined-root", role="superuser"))
        late = make_user("late-joiner")
        late.date_joined = datetime(2026, 11, 25, 20, 7, tzinfo=UTC)  # 01:07 in UTC+5
        late.save(update_fields=["date_joined"])
        early = make_user("early-joiner")
        early.date_joined = datetime(2026, 11, 25, 18, 0, tzinfo=UTC)  # 23:00 the day before
        early.save(update_fields=["date_joined"])

        rows = client.get(
            "/api/v1/admin/users/", {"joined_since": "2026-11-26T00:00:00+05:00", "page_size": 50}
        ).data["results"]
        names = {row["username"] for row in rows}
        self.assertIn("late-joiner", names)
        self.assertNotIn("early-joiner", names)
