"""Announcements: admin CRUD, the in-app broadcast and the public banner endpoint."""

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ...core.models import Announcement, AuditLog, CeleryTaskResult, Notification
from ...core.services.announcement_service import broadcast_announcement
from .helpers import bearer_client, make_user

BASE = "/api/v1/admin/announcements/"
PUBLIC = "/api/v1/announcements/active/"


class AnnouncementTests(TestCase):
    def setUp(self):
        patcher = patch("celery.app.base.Celery.send_task", return_value=None)
        self.send_task = patcher.start()
        self.addCleanup(patcher.stop)
        self.staff_client = bearer_client(make_user("mod", role="staff"))
        self.root = make_user("root", role="superuser")
        self.root_client = bearer_client(self.root)

    def _create(self, **fields):
        payload = {"title": "Maintenance tonight", "body": "Back by 2am.", **fields}
        return self.root_client.post(BASE, payload, format="json")

    def test_writes_are_superuser_only_and_audited(self):
        self.assertEqual(
            self.staff_client.post(BASE, {"title": "x"}, format="json").status_code, 403
        )
        response = self._create(level="warning")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["created_by"]["username"], "root")
        self.assertEqual(self.staff_client.get(BASE).data["count"], 1)
        self.assertEqual(AuditLog.objects.get().action, "CREATE")

    def test_validation(self):
        now = timezone.now()
        self.assertEqual(
            self._create(
                starts_at=now.isoformat(), ends_at=(now - timedelta(hours=1)).isoformat()
            ).status_code,
            400,
        )
        self.assertEqual(self._create(link_label="Read more").status_code, 400)
        self.assertEqual(self._create(body="x" * 1001).status_code, 400)
        self.assertEqual(self._create(level="loud").status_code, 400)

    def test_public_endpoint_shows_live_banners_and_drops_its_cache_on_change(self):
        client = APIClient()
        self.assertEqual(client.get(PUBLIC).json(), [])
        with self.captureOnCommitCallbacks(execute=True):
            live = self._create()
            self._create(title="Later", starts_at=(timezone.now() + timedelta(days=1)).isoformat())
            self._create(title="Hidden", show_banner=False)

        rows = client.get(PUBLIC).json()
        self.assertEqual([row["title"] for row in rows], ["Maintenance tonight"])

        with self.captureOnCommitCallbacks(execute=True):
            self.root_client.patch(f"{BASE}{live.data['id']}/", {"is_active": False}, format="json")
        self.assertEqual(client.get(PUBLIC).json(), [])

    def test_notify_queues_once_unless_forced(self):
        announcement = self._create().data
        url = f"{BASE}{announcement['id']}/notify/"
        self.assertEqual(
            self.staff_client.post(url, {"audience": "all"}, format="json").status_code, 403
        )
        self.assertEqual(
            self.root_client.post(url, {"audience": "everyone"}, format="json").status_code, 400
        )
        response = self.root_client.post(url, {"audience": "staff"}, format="json")
        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(response.data["estimated_recipients"], 2)
        job = CeleryTaskResult.objects.get()
        self.assertEqual(job.queue, "notifications")
        self.assertEqual(
            job.task_kwargs, {"announcement_id": announcement["id"], "audience": "staff"}
        )

        # Queued: refused at once, even with force, so a double click sends nothing twice.
        self.assertEqual(Announcement.objects.get(pk=announcement["id"]).notify_status, "queued")
        self.assertEqual(
            self.root_client.post(
                url, {"audience": "staff", "force": True}, format="json"
            ).status_code,
            409,
        )

        Announcement.objects.filter(pk=announcement["id"]).update(
            notify_status="sent", notified_at=timezone.now()
        )
        self.assertEqual(
            self.root_client.post(url, {"audience": "staff"}, format="json").status_code, 409
        )
        forced = self.root_client.post(url, {"audience": "staff", "force": True}, format="json")
        self.assertEqual(forced.status_code, 202)

    def test_broadcast_creates_in_app_notifications_once(self):
        make_user("member")
        inactive = make_user("gone")
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        announcement = Announcement.objects.create(
            title="Hi", body="Welcome", link_url="https://a.b/"
        )

        first = broadcast_announcement(announcement.id, "all")
        second = broadcast_announcement(announcement.id, "all")

        self.assertEqual((first["created"], second["created"]), (3, 0))
        rows = Notification.objects.filter(dedupe_key=f"announcement:{announcement.id}")
        self.assertEqual(rows.count(), 3)
        self.assertTrue(all(row.is_push_sent and row.is_email_sent for row in rows))
        self.assertEqual(rows[0].notification_type, "system")
        announcement.refresh_from_db()
        self.assertEqual(announcement.notified_count, 3)
        self.assertIsNotNone(announcement.notified_at)

    def test_links_take_site_paths_or_web_addresses_only(self):
        for good in ("/schedule", "https://example.com/news"):
            created = self._create(link_url=good)
            self.assertEqual(created.status_code, 201, created.data)
        for bad in ("javascript:alert(1)", "//evil.example", "schedule", "ftp://x.y/z"):
            refused = self._create(link_url=bad)
            self.assertEqual(refused.status_code, 400, bad)
            self.assertIn("link_url", refused.data["errors"])

    def test_in_app_notices_link_to_site_paths_only(self):
        internal = Announcement.objects.create(title="A", link_url="/forums")
        external = Announcement.objects.create(title="B", link_url="https://example.com/")
        broadcast_announcement(internal.id, "all")
        broadcast_announcement(external.id, "all")
        urls = dict(Notification.objects.values_list("dedupe_key", "data__url"))
        self.assertEqual(urls[f"announcement:{internal.id}"], "/forums")
        self.assertEqual(urls[f"announcement:{external.id}"], "")
        internal.refresh_from_db()
        self.assertEqual(internal.notify_status, "sent")

    def test_list_filters_by_level_and_state(self):
        self._create(title="Calm", level="info")
        self._create(title="Loud", level="critical", is_active=False)
        rows = self.staff_client.get(BASE, {"level": "critical", "is_active": "false"}).data[
            "results"
        ]
        self.assertEqual([row["title"] for row in rows], ["Loud"])

    def test_a_send_claimed_by_another_request_meanwhile_is_refused(self):
        announcement = self._create().data
        url = f"{BASE}{announcement['id']}/notify/"

        def other_request_wins(row, now=None):
            # Another admin's request claims it between this one's read and claim.
            Announcement.objects.filter(pk=row.pk).update(
                notify_status="queued", notify_queued_at=timezone.now()
            )
            return False

        with patch(
            "apps.admin_api.views.announcements.announcement_send_is_stuck",
            side_effect=other_request_wins,
        ):
            response = self.root_client.post(url, {"audience": "staff"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertFalse(CeleryTaskResult.objects.exists())

    def test_a_stuck_send_can_be_forced_again(self):
        announcement = self._create().data
        url = f"{BASE}{announcement['id']}/notify/"
        Announcement.objects.filter(pk=announcement["id"]).update(
            notify_status="queued", notify_queued_at=timezone.now() - timedelta(minutes=20)
        )
        self.assertEqual(
            self.root_client.post(url, {"audience": "staff"}, format="json").status_code, 409
        )
        forced = self.root_client.post(url, {"audience": "staff", "force": True}, format="json")
        self.assertEqual(forced.status_code, 202, forced.data)

    def test_a_failed_send_can_be_retried_without_force(self):
        announcement = self._create().data
        Announcement.objects.filter(pk=announcement["id"]).update(notify_status="failed")
        response = self.root_client.post(
            f"{BASE}{announcement['id']}/notify/", {"audience": "staff"}, format="json"
        )
        self.assertEqual(response.status_code, 202, response.data)

    def test_two_admins_re_claiming_a_stuck_send_get_one_job(self):
        announcement = self._create().data
        url = f"{BASE}{announcement['id']}/notify/"
        Announcement.objects.filter(pk=announcement["id"]).update(
            notify_status="queued", notify_queued_at=timezone.now() - timedelta(minutes=20)
        )
        real_is_stuck = __import__(
            "apps.core.services.announcement_service", fromlist=["x"]
        ).announcement_send_is_stuck

        def other_admin_reclaims_first(row, now=None):
            stuck = real_is_stuck(row, now)
            # Another admin's forced re-claim lands between this read and claim.
            Announcement.objects.filter(pk=row.pk).update(notify_queued_at=timezone.now())
            return stuck

        with patch(
            "apps.admin_api.views.announcements.announcement_send_is_stuck",
            side_effect=other_admin_reclaims_first,
        ):
            response = self.root_client.post(
                url, {"audience": "staff", "force": True}, format="json"
            )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(CeleryTaskResult.objects.exists())

    def test_a_failed_re_send_retries_without_force_even_after_an_earlier_send(self):
        announcement = self._create().data
        Announcement.objects.filter(pk=announcement["id"]).update(
            notify_status="failed", notified_at=timezone.now()
        )
        response = self.root_client.post(
            f"{BASE}{announcement['id']}/notify/", {"audience": "staff"}, format="json"
        )
        self.assertEqual(response.status_code, 202, response.data)

    def test_the_send_remembers_its_audience(self):
        announcement = self._create().data
        self.root_client.post(
            f"{BASE}{announcement['id']}/notify/", {"audience": "staff"}, format="json"
        )
        row = self.staff_client.get(f"{BASE}{announcement['id']}/").data
        self.assertEqual((row["notify_status"], row["notify_audience"]), ("queued", "staff"))

    def test_a_send_switched_off_while_queued_sends_nothing(self):
        make_user("member-x")
        announcement = Announcement.objects.create(
            title="Off", is_active=False, notify_status="queued", notify_queued_at=timezone.now()
        )
        result = broadcast_announcement(announcement.id, "all")
        self.assertEqual(result["status"], "skipped")
        self.assertFalse(
            Notification.objects.filter(dedupe_key=f"announcement:{announcement.id}").exists()
        )
        announcement.refresh_from_db()
        self.assertEqual(announcement.notify_status, "")

    def test_saving_without_a_change_writes_no_audit_row_and_deletes_keep_the_text(self):
        made = self._create(body="Keep this text").data
        AuditLog.objects.all().delete()
        self.root_client.patch(f"{BASE}{made['id']}/", {"title": made["title"]}, format="json")
        self.assertFalse(AuditLog.objects.exists())
        self.root_client.delete(f"{BASE}{made['id']}/")
        row = AuditLog.objects.get(action="DELETE")
        self.assertEqual(row.previous_state["body"], "Keep this text")
