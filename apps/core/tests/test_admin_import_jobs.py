import threading
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.utils import timezone

from ...admin_api.tests.helpers import bearer_client, make_user
from ..models import AuditLog, CeleryTaskResult
from ..services.admin_import_jobs_service import (
    CATALOG_SYNC_TASK,
    format_task_result,
    trigger_import_job,
)
from ..views.admin_import_jobs import OFFLINE_RECONCILE_TASK, AdminImportJobFilter


class FormatTaskResultTests(SimpleTestCase):
    def test_trending_catalog_sync_uses_anilist_source_label(self):
        result = CeleryTaskResult(
            id=8111,
            task_id="task-trending-1",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"sync_type": "trending", "limit": 10},
            result_data={"records_processed": 7},
        )

        payload = format_task_result(result)

        assert payload["source"] == "AniList"
        assert payload["source_type"] == "Trending"
        assert payload["processed_items"] == 7
        assert payload["total_items"] == 10

    def test_metadata_enrichment_uses_anilist_source_label(self):
        result = CeleryTaskResult(
            id=8123,
            task_id="task-meta-1",
            task_name="apps.animes.tasks.metadata.enrich_metadata",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"mode": "backfill", "batch_size": 10},
            result_data={"total": 8, "updated": 5, "no_results": 2, "errors": 1},
        )

        payload = format_task_result(result)

        assert payload["source"] == "AniList"
        assert payload["source_type"] == "Metadata Enrichment"
        assert payload["processed_items"] == 8
        assert payload["total_items"] == 8
        assert payload["error_count"] == 1

    def test_offline_reconcile_progress_counts_quarantined_as_terminal(self):
        result = CeleryTaskResult(
            id=7453,
            task_id="task-123",
            task_name=OFFLINE_RECONCILE_TASK,
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={},
            result_data={
                "pending": 3,
                "complete": 58,
                "quarantined_count": 39,
                "blocked_without_ids": 0,
            },
        )

        payload = format_task_result(result)

        assert payload["processed_items"] == 97
        assert payload["total_items"] == 100

    def test_catalog_business_failure_is_displayed_as_failed(self):
        result = CeleryTaskResult(
            id=8124,
            task_id="task-empty-sync",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            date_created=timezone.now(),
            date_completed=timezone.now(),
            task_kwargs={"sync_type": "trending", "limit": 50},
            result_data={
                "status": "no_data",
                "sync_type": "trending",
                "records_processed": 0,
                "fetched": 0,
            },
        )

        payload = format_task_result(result)

        assert payload["status"] == "failed"
        assert payload["error_count"] == 1
        assert payload["total_items"] == 50
        assert "no usable data" in payload["error_message"]


class AdminImportJobTriggerApiTests(TestCase):
    """Trigger/cancel through the API with real JWTs (G6 P0-2, P0-3)."""

    def setUp(self):
        self.staff = make_user("ij-staff", role="staff")
        self.root = bearer_client(make_user("ij-root", role="superuser"))
        patcher = patch("apps.core.services.admin_import_jobs_service.current_app.send_task")
        self.send_task = patcher.start()
        self.addCleanup(patcher.stop)
        self.send_task.side_effect = lambda *a, **k: SimpleNamespace(id=f"task-{uuid4().hex}")

    def _trigger(self, client, **payload):
        return client.post("/api/v1/admin/import-jobs/trigger/", payload, format="json")

    def test_staff_cannot_trigger_or_cancel(self):
        job = CeleryTaskResult.objects.create(task_id="j-1", task_name=CATALOG_SYNC_TASK)
        staff = bearer_client(self.staff)

        trigger = self._trigger(staff, source="trending")
        cancel = staff.post(f"/api/v1/admin/import-jobs/{job.id}/cancel/")
        listing = staff.get("/api/v1/admin/import-jobs/")

        self.assertEqual(trigger.status_code, 403)
        self.assertEqual(cancel.status_code, 403)
        self.assertEqual(listing.status_code, 200)
        self.send_task.assert_not_called()

    def test_offline_trigger_never_forwards_source_url_or_path(self):
        response = self._trigger(
            self.root,
            source="offline_catalog",
            source_url="http://169.254.169.254/latest/meta-data/",
            source_path="/etc/passwd",
        )

        self.assertEqual(response.status_code, 202)
        kwargs = self.send_task.call_args.kwargs["kwargs"]
        self.assertNotIn("source_url", kwargs)
        self.assertNotIn("source_path", kwargs)
        self.assertEqual(kwargs["asset_name"], "anime-offline-database.jsonl.zst")

    def test_offline_trigger_rejects_bad_release_tag_and_asset(self):
        bad_payloads: list[dict[str, str]] = [
            {"release_tag": "../../etc"},
            {"release_tag": "x" * 41},
            {"asset_name": "other.zip"},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                response = self._trigger(self.root, source="offline_catalog", **payload)
                self.assertEqual(response.status_code, 400)
        self.send_task.assert_not_called()

    def test_limits_are_bounded(self):
        cases: list[tuple[dict[str, object], int]] = [
            ({"source": "trending", "limit": 10_000}, 400),
            ({"source": "trending", "limit": 0}, 400),
            ({"source": "anime_catalog", "sync_type": "seasonal", "limit": 501}, 400),
            ({"source": "anime_catalog", "sync_type": "full_catalog", "limit": 5001}, 400),
            ({"source": "metadata_enrichment", "batch_size": 501}, 400),
            ({"source": "metadata_enrichment", "status": "Bogus"}, 400),
            ({"source": "trending", "limit": "ten"}, 400),
        ]
        for payload, expected in cases:
            with self.subTest(payload=payload):
                self.assertEqual(self._trigger(self.root, **payload).status_code, expected)
        self.send_task.assert_not_called()

    def test_only_the_four_canonical_sources_are_accepted(self):
        for source in ("jikan_trending", "jikan_enrichment", "anilist_sync", "catalog_sync", None):
            with self.subTest(source=source):
                response = self._trigger(self.root, source=source)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("jikan", response.data["detail"])

    def test_second_trigger_while_pending_is_a_conflict(self):
        first = self._trigger(self.root, source="trending")
        second = self._trigger(self.root, source="anime_catalog", sync_type="airing")

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(self.send_task.call_count, 1)

    def test_stale_pending_row_does_not_block(self):
        stale = CeleryTaskResult.objects.create(task_id="old", task_name=CATALOG_SYNC_TASK)
        CeleryTaskResult.objects.filter(pk=stale.pk).update(
            date_created=timezone.now() - timedelta(days=1)
        )

        self.assertEqual(self._trigger(self.root, source="trending").status_code, 202)

    def test_trigger_and_cancel_write_one_audit_row_each(self):
        response = self._trigger(self.root, source="trending", limit=20)
        job_id = response.data["job_id"]
        with patch("apps.core.services.admin_import_jobs_service.current_app.control.revoke"):
            cancel = self.root.post(f"/api/v1/admin/import-jobs/{job_id}/cancel/")

        self.assertEqual(cancel.status_code, 200)
        actions = list(AuditLog.objects.order_by("id").values_list("action", "entity_id"))
        self.assertEqual(
            actions,
            [
                (AuditLog.ActionType.TRIGGER, str(job_id)),
                (AuditLog.ActionType.CONTROL, str(job_id)),
            ],
        )

    def test_unexpected_failure_is_generic(self):
        self.send_task.side_effect = RuntimeError("redis://:hunter2@broker refused")

        response = self._trigger(self.root, source="trending")

        self.assertEqual(response.status_code, 500)
        self.assertNotIn("hunter2", str(response.data))


class AdminImportJobFilterTests(TestCase):
    def test_failed_filter_includes_business_failure_success_rows(self):
        failed = CeleryTaskResult.objects.create(
            task_id="task-business-failed",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "no_data"},
        )
        completed = CeleryTaskResult.objects.create(
            task_id="task-success",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "success"},
        )

        queryset = AdminImportJobFilter(
            {"status": "failed"},
            queryset=CeleryTaskResult.objects.all(),
        ).qs

        self.assertIn(failed, queryset)
        self.assertNotIn(completed, queryset)

    def test_completed_filter_excludes_business_failure_success_rows(self):
        failed = CeleryTaskResult.objects.create(
            task_id="task-business-failed",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "source_unhealthy"},
        )
        completed = CeleryTaskResult.objects.create(
            task_id="task-success",
            task_name="apps.animes.tasks.sync.sync_anime_catalog",
            status=CeleryTaskResult.TaskStatus.SUCCESS,
            result_data={"status": "success"},
        )

        queryset = AdminImportJobFilter(
            {"status": "completed"},
            queryset=CeleryTaskResult.objects.all(),
        ).qs

        self.assertIn(completed, queryset)
        self.assertNotIn(failed, queryset)


class ExclusiveTriggerRaceTests(TransactionTestCase):
    """Two simultaneous triggers of the same task: one 202, one 409 (advisory lock)."""

    def test_concurrent_triggers_queue_exactly_one_job(self):
        user = make_user("race-root", role="superuser")
        barrier = threading.Barrier(2)
        results: list[int] = []
        real_create = CeleryTaskResult.objects.create

        def slow_create(**fields):
            # Hold the first claim open long enough for the second request to arrive.
            row = real_create(**fields)
            time.sleep(0.5)
            return row

        def trigger():
            try:
                barrier.wait(timeout=5)
                results.append(trigger_import_job({"source": "trending"}, user).status_code)
            finally:
                connection.close()

        with (
            patch(
                "apps.core.services.celery_admin_service.current_app.send_task",
                return_value=SimpleNamespace(id="x"),
            ) as send_task,
            patch.object(CeleryTaskResult.objects, "create", side_effect=slow_create),
        ):
            threads = [threading.Thread(target=trigger) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=20)

        self.assertEqual(sorted(results), [202, 409])
        self.assertEqual(send_task.call_count, 1)
        self.assertEqual(CeleryTaskResult.objects.count(), 1)
