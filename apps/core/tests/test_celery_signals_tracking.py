"""High-frequency tasks write no CeleryTaskResult rows, only a last-run stamp (G6 P0-5a)."""

from types import SimpleNamespace

from django.core.cache import cache
from django.test import TestCase

from .. import celery_signals
from ..celery_signals import UNTRACKED_TASKS, last_run_cache_key
from ..models import CeleryTaskResult
from ..tasks.logging_tasks import log_request_async


def _task(name):
    return SimpleNamespace(name=name, request=SimpleNamespace(id="t"))


class UntrackedTaskTests(TestCase):
    def test_the_list_names_the_per_request_and_minute_tasks(self):
        self.assertEqual(
            UNTRACKED_TASKS,
            {
                "apps.core.tasks.logging_tasks.log_request_async",
                "apps.core.tasks.logging_tasks.log_exception_async",
                "apps.core.tasks.cleanup_tasks.collect_queue_metrics",
                "apps.core.tasks.cleanup_tasks.flush_forum_view_counts",
            },
        )

    def test_untracked_task_writes_no_row_and_stamps_last_run(self):
        name = "apps.core.tasks.logging_tasks.log_request_async"
        task = _task(name)

        celery_signals.on_task_prerun(task_id="u-1", task=task, args=(), kwargs={})
        celery_signals.on_task_success(sender=task, result={"ok": True})
        celery_signals.on_task_failure(
            task_id="u-1", exception=ValueError("x"), traceback=None, sender=task
        )

        self.assertFalse(CeleryTaskResult.objects.exists())
        self.assertIsNotNone(cache.get(last_run_cache_key(name)))

    def test_eager_request_log_creates_no_task_result(self):
        log_request_async.apply(
            args=[
                {
                    "level": "INFO",
                    "log_type": "REQUEST",
                    "method": "GET",
                    "path": "/x",
                    "status_code": 200,
                    "message": "GET /x - 200",
                    "details": {},
                    "user_ip": "203.0.113.1",
                }
            ]
        )

        self.assertFalse(CeleryTaskResult.objects.exists())

    def test_tracked_task_args_are_capped(self):
        task = _task("apps.animes.tasks.catalog.run_catalog_lane")
        huge = ["x" * 5000]

        celery_signals.on_task_prerun(
            task_id="t-1", task=task, args=huge, kwargs={"note": "y" * 5000}
        )

        row = CeleryTaskResult.objects.get(task_id="t-1")
        self.assertEqual(row.task_args[0], "[truncated]")
        self.assertTrue(row.task_kwargs["_truncated"])
        self.assertLessEqual(len(row.task_args[1]), 1024)

    def test_small_payloads_are_stored_as_is(self):
        task = _task("apps.animes.tasks.catalog.run_catalog_lane")

        celery_signals.on_task_prerun(
            task_id="t-2", task=task, args=[1], kwargs={"lane": "trending"}
        )

        row = CeleryTaskResult.objects.get(task_id="t-2")
        self.assertEqual((row.task_args, row.task_kwargs), ([1], {"lane": "trending"}))
