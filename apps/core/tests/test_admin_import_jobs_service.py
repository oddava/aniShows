from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from ..celery_signals import on_task_prerun
from ..models import CeleryTaskResult
from ..services.admin_import_jobs_service import (
    CATALOG_SYNC_TASK,
    FULL_CATALOG_LIMIT,
    OFFLINE_IMPORT_TASK,
    ImportTriggerError,
    create_pending_job,
    trigger_import_job,
)


class AdminImportJobsServiceTests(TestCase):
    """Each canonical source queues the right task with bounded kwargs."""

    def setUp(self):
        patcher = patch("apps.core.services.admin_import_jobs_service.create_pending_job")
        self.create_pending_job = patcher.start()
        self.addCleanup(patcher.stop)
        self.create_pending_job.return_value = SimpleNamespace(id="job-1")
        self.user = SimpleNamespace(is_authenticated=True)

    def _queued(self):
        self.create_pending_job.assert_called_once()
        return self.create_pending_job.call_args.kwargs

    def test_full_catalog_defaults_to_broader_limit(self):
        result = trigger_import_job(
            {"source": "anime_catalog", "sync_type": "full_catalog"}, self.user
        )

        self.assertEqual(result.status_code, 202)
        queued = self._queued()
        self.assertEqual(queued["task_path"], CATALOG_SYNC_TASK)
        self.assertEqual(
            queued["kwargs"], {"sync_type": "full_catalog", "limit": FULL_CATALOG_LIMIT}
        )
        self.assertEqual(queued["queue"], "default")

    def test_trending_routes_to_anilist_backed_catalog_sync(self):
        trigger_import_job({"source": "trending"}, self.user)

        queued = self._queued()
        self.assertEqual(queued["kwargs"], {"sync_type": "trending", "limit": 50})
        self.assertEqual(queued["queue"], "high_priority")

    def test_seasonal_routes_to_local_catalog_sync(self):
        trigger_import_job({"source": "anime_catalog", "sync_type": "seasonal"}, self.user)

        self.assertEqual(self._queued()["kwargs"], {"sync_type": "seasonal", "limit": 50})

    def test_metadata_enrichment_uses_the_enrichment_task(self):
        result = trigger_import_job(
            {"source": "metadata_enrichment", "batch_size": 25, "status": "Airing"}, self.user
        )

        self.assertIn("AniList", result.payload["message"])
        queued = self._queued()
        self.assertEqual(queued["task_path"], "apps.animes.tasks.metadata.enrich_metadata")
        self.assertEqual(
            queued["kwargs"],
            {
                "mode": "backfill",
                "batch_size": 25,
                "missing_tags_only": False,
                "filters": {"status": "Airing"},
            },
        )

    def test_offline_import_defaults_to_resume_without_source_overrides(self):
        trigger_import_job({"source": "offline_catalog"}, self.user)

        queued = self._queued()
        self.assertEqual(queued["task_path"], OFFLINE_IMPORT_TASK)
        self.assertEqual(
            queued["kwargs"],
            {
                "release_tag": "latest",
                "asset_name": "anime-offline-database.jsonl.zst",
                "limit": None,
                "resume": True,
                "enqueue_enrichment": True,
                "enforce_full_sync": True,
                "batch_size": 250,
                "enrichment_chunk_size": 100,
            },
        )

    def test_bad_input_raises_a_safe_error(self):
        with self.assertRaisesMessage(ImportTriggerError, "between 1 and 500"):
            trigger_import_job({"source": "trending", "limit": 10_000}, self.user)
        self.create_pending_job.assert_not_called()


class CreatePendingJobTests(TestCase):
    """The tracking row exists before the task is sent (no prerun race on task_id)."""

    @patch("apps.core.services.celery_admin_service.current_app.send_task")
    def test_row_is_recorded_before_the_task_is_sent(self, mock_send_task):
        seen = {}

        def send(task_path, **options):
            row = CeleryTaskResult.objects.get(task_id=options["task_id"])
            seen.update(status=row.status, queue=row.queue)
            # The worker starts the task before the request returns.
            on_task_prerun(
                task_id=options["task_id"],
                task=SimpleNamespace(name=task_path),
                args=(),
                kwargs=options["kwargs"],
            )
            return SimpleNamespace(id=options["task_id"])

        mock_send_task.side_effect = send
        job = create_pending_job(
            user=None,
            task_path="apps.animes.tasks.sync.sync_anime_catalog",
            task_module="apps.animes.tasks.sync",
            kwargs={"sync_type": "trending", "limit": 50},
            queue="high_priority",
        )

        self.assertEqual(seen, {"status": "PENDING", "queue": "high_priority"})
        self.assertEqual(CeleryTaskResult.objects.count(), 1)
        job.refresh_from_db()
        self.assertEqual(job.status, CeleryTaskResult.TaskStatus.STARTED)
        self.assertEqual(job.task_kwargs, {"sync_type": "trending", "limit": 50})

    @patch("apps.core.services.celery_admin_service.current_app.send_task")
    def test_a_failed_send_marks_the_row_failed_and_does_not_block(self, mock_send_task):
        mock_send_task.side_effect = OSError("broker down")
        kwargs = {
            "user": None,
            "task_path": "apps.animes.tasks.sync.sync_anime_catalog",
            "task_module": "apps.animes.tasks.sync",
            "kwargs": {"sync_type": "trending", "limit": 50},
            "queue": "high_priority",
        }
        with self.assertRaises(OSError):
            create_pending_job(**kwargs)
        self.assertEqual(CeleryTaskResult.objects.get().status, "FAILURE")

        mock_send_task.side_effect = None
        mock_send_task.return_value = SimpleNamespace(id="ok")
        create_pending_job(**kwargs)
        self.assertEqual(CeleryTaskResult.objects.filter(status="PENDING").count(), 1)
