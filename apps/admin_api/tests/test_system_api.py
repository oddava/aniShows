"""The admin System page (G6 P1-3). Broker, workers and AniList are mocked."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.conf import settings
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from ...core.celery_signals import last_run_cache_key
from ...core.models import AuditLog, CeleryTaskResult
from ...core.services import celery_monitoring
from ..services import system_service
from .helpers import bearer_client, make_user

URL = "/api/v1/admin/system/"
CLEANUP_TASK = "apps.core.tasks.cleanup_tasks.cleanup_old_task_results"
FLUSH_TASK = "apps.core.tasks.cleanup_tasks.flush_forum_view_counts"


def _control(ping=None, active=None):
    control = MagicMock()
    control.ping.return_value = ping or []
    control.inspect.return_value.active.return_value = active or {}
    return control


class SystemPageTests(TestCase):
    def setUp(self):
        self.staff_client = bearer_client(make_user("sys-staff", role="staff"))
        self.root = make_user("sys-root", role="superuser")
        self.root_client = bearer_client(self.root)
        control = patch.object(
            system_service.current_app,
            "control",
            _control(
                ping=[{"celery@w1": {"ok": "pong"}}, {"celery@w2": {"ok": "pong"}}],
                active={"celery@w1": [{"id": "a"}, {"id": "b"}]},
            ),
        )
        control.start()
        self.addCleanup(control.stop)

    def test_queues_are_read_from_the_broker_not_the_cache(self):
        broker = MagicMock()
        broker.llen.side_effect = lambda key: {"default": 4, "default\x06\x163": 1}.get(key, 0)
        with (
            patch.object(
                celery_monitoring.redis.Redis, "from_url", return_value=broker
            ) as from_url,
            patch.object(
                celery_monitoring, "settings", SimpleNamespace(CELERY_BROKER_URL="redis://b:6379/1")
            ),
        ):
            data = self.staff_client.get(URL).data

        from_url.assert_called_once()
        self.assertEqual(from_url.call_args.args[0], "redis://b:6379/1")
        sizes = {item["name"]: item["size"] for item in data["queues"]["items"]}
        self.assertTrue(data["queues"]["available"])
        self.assertEqual(sizes["default"], 5)
        self.assertNotIn("dead_letter", sizes)

    def test_unreachable_broker_marks_queues_unavailable(self):
        with patch.object(celery_monitoring, "_get_redis_client", return_value=None):
            data = self.staff_client.get(URL).data
        self.assertEqual(data["queues"], {"available": False, "items": []})

    def test_workers_from_ping_and_inspect(self):
        data = self.staff_client.get(URL).data

        self.assertEqual(
            data["workers"],
            {
                "available": True,
                "items": [
                    {"name": "celery@w1", "active_tasks": 2},
                    {"name": "celery@w2", "active_tasks": 0},
                ],
                "total": 2,
            },
        )

    def test_every_beat_entry_is_listed_with_its_last_run(self):
        CeleryTaskResult.objects.create(task_id="c-1", task_name=CLEANUP_TASK)
        stale_run = timezone.now() - timedelta(days=3)
        CeleryTaskResult.objects.filter(task_id="c-1").update(date_created=stale_run)
        cache.set(last_run_cache_key(FLUSH_TASK), timezone.now().isoformat())

        beat = {row["name"]: row for row in self.staff_client.get(URL).data["beat"]}

        self.assertEqual(set(beat), set(settings.CELERY_BEAT_SCHEDULE))
        cleanup = beat["cleanup-task-results-daily"]
        self.assertEqual(cleanup["schedule"], "0 1 * * *")
        self.assertEqual(cleanup["kwargs"], {"days": 7, "batch_size": 1000})
        self.assertTrue(cleanup["stale"])
        self.assertIsNotNone(cleanup["next_due"])
        flush = beat["flush-forum-view-counts-minute"]
        self.assertFalse(flush["tracked"])
        self.assertIsNotNone(flush["last_run"])
        self.assertFalse(flush["stale"])
        never = [row for row in beat.values() if row["last_run"] is None]
        self.assertTrue(never)
        self.assertTrue(all(row["next_due"] is None for row in never))
        self.assertNotIn("collect-queue-metrics-minute", beat)

    def test_last_run_is_matched_per_entry_not_per_task(self):
        sync = "apps.animes.tasks.sync.sync_anime_catalog"
        CeleryTaskResult.objects.create(
            task_id="tr-1", task_name=sync, task_kwargs={"sync_type": "trending", "limit": 50}
        )
        old = CeleryTaskResult.objects.create(
            task_id="up-1", task_name=sync, task_kwargs={"sync_type": "next_season", "limit": 100}
        )
        CeleryTaskResult.objects.filter(pk=old.pk).update(
            date_created=timezone.now() - timedelta(days=6)
        )

        beat = {row["name"]: row for row in self.staff_client.get(URL).data["beat"]}

        trending, upcoming = beat["sync-trending-hourly"], beat["sync-upcoming-weekly"]
        self.assertGreater(trending["last_run"], upcoming["last_run"])
        self.assertFalse(trending["stale"])
        self.assertNotEqual(beat["sync-seasonal-daily"]["last_run"], trending["last_run"])

    def test_a_missed_run_inside_the_retained_history_is_stale(self):
        stamp = CeleryTaskResult.objects.create(task_id="old-1", task_name=CLEANUP_TASK)
        CeleryTaskResult.objects.filter(pk=stamp.pk).update(
            date_created=timezone.now() - timedelta(days=5)
        )

        beat = {row["name"]: row for row in self.staff_client.get(URL).data["beat"]}

        seasonal = beat["sync-seasonal-daily"]  # daily, never seen in 5 days of history
        self.assertIsNone(seasonal["last_run"])
        self.assertTrue(seasonal["stale"])
        self.assertFalse(beat["flush-forum-view-counts-minute"]["stale"])  # untracked

    def test_anilist_is_unavailable_without_the_r7_accessor(self):
        self.assertEqual(self.staff_client.get(URL).data["anilist"], {"available": False})

    def test_anilist_uses_the_accessors_once_they_exist(self):
        from ...animes.services import rate_limiting

        snapshot = {
            "limit": 90,
            "used_this_minute": 12,
            "interactive_used": 3,
            "paused_until": None,
        }
        with (
            patch.object(
                rate_limiting.AniListRateLimiter, "snapshot", create=True, return_value=snapshot
            ),
            patch.object(
                rate_limiting.CircuitBreaker,
                "state",
                create=True,
                return_value={"state": "closed", "failures": 0, "last_failure": None},
            ),
        ):
            data = self.staff_client.get(URL, {"refresh": "1"}).data["anilist"]

        self.assertTrue(data["available"])
        self.assertEqual(data["used_this_minute"], 12)
        self.assertEqual(data["breaker"]["state"], "closed")

    def test_database_health_failures_and_can_run(self):
        CeleryTaskResult.objects.create(
            task_id="f-1", task_name=CLEANUP_TASK, status="FAILURE", error_message="e" * 500
        )

        staff = self.staff_client.get(URL).data
        root = self.root_client.get(URL, {"refresh": "1"}).data

        self.assertTrue(staff["database"]["available"])
        self.assertGreater(staff["database"]["size_bytes"], 0)
        self.assertLessEqual(len(staff["database"]["tables"]), 8)
        self.assertEqual(staff["health"]["database"], True)
        self.assertIn(staff["health"]["migrations_pending"], (True, False))
        self.assertEqual(len(staff["failures"][0]["error_message"]), 300)
        self.assertNotIn("task_kwargs", staff["failures"][0])
        self.assertFalse(staff["can_run"])
        self.assertTrue(root["can_run"])

    def test_payload_is_cached_until_refresh(self):
        first = self.staff_client.get(URL).data
        CeleryTaskResult.objects.create(task_id="f-2", task_name=CLEANUP_TASK, status="FAILURE")
        cached = self.staff_client.get(URL).data
        fresh = self.staff_client.get(URL, {"refresh": "1"}).data

        self.assertEqual(first["failures"], cached["failures"])
        self.assertEqual(len(fresh["failures"]), 1)


class BeatRunTests(TestCase):
    def setUp(self):
        self.root = make_user("beat-root", role="superuser")
        self.client = bearer_client(self.root)
        patcher = patch.object(system_service.current_app, "send_task")
        self.send_task = patcher.start()
        self.addCleanup(patcher.stop)
        self.send_task.return_value = SimpleNamespace(id="beat-task-1")

    def _run(self, entry, client=None, **payload):
        return (client or self.client).post(
            f"/api/v1/admin/system/beat/{entry}/run/", payload, format="json"
        )

    def test_runs_with_the_configured_kwargs_only(self):
        response = self._run("cleanup-task-results-daily", days=1, batch_size=999999)

        self.assertEqual(response.status_code, 202)
        self.send_task.assert_called_once_with(
            CLEANUP_TASK,
            args=[],
            kwargs={"days": 7, "batch_size": 1000},
            task_id=response.data["task_id"],
            queue="low_priority",
        )
        self.assertEqual(
            CeleryTaskResult.objects.get(task_id=response.data["task_id"]).status, "PENDING"
        )
        row = AuditLog.objects.get()
        self.assertEqual(
            (row.action, row.entity_id), (AuditLog.ActionType.TRIGGER, "cleanup-task-results-daily")
        )

    def test_untracked_entry_cannot_be_rerun_within_a_minute(self):
        first = self._run("flush-forum-view-counts-minute")
        second = self._run("flush-forum-view-counts-minute")

        self.assertEqual((first.status_code, second.status_code), (202, 409))
        self.assertEqual(self.send_task.call_count, 1)
        self.assertFalse(CeleryTaskResult.objects.exists())

    def test_untracked_claim_is_released_when_the_send_fails(self):
        self.send_task.side_effect = OSError("broker down")
        response = self._run("flush-forum-view-counts-minute")
        self.assertEqual(response.status_code, 500)  # the view answers a generic 500

        self.send_task.side_effect = None
        self.assertEqual(self._run("flush-forum-view-counts-minute").status_code, 202)

    def test_untracked_run_goes_ahead_when_the_cache_is_down(self):
        broken_cache = MagicMock()
        broken_cache.add.side_effect = OSError("cache down")
        with patch.object(system_service, "cache", broken_cache):
            response = self._run("flush-forum-view-counts-minute")

        self.assertEqual(response.status_code, 202)
        self.send_task.assert_called_once()

    def test_unknown_entry_is_404(self):
        self.assertEqual(self._run("drop-all-tables").status_code, 404)
        self.send_task.assert_not_called()

    def test_in_flight_task_is_a_conflict(self):
        CeleryTaskResult.objects.create(task_id="busy", task_name=CLEANUP_TASK, status="STARTED")

        self.assertEqual(self._run("cleanup-task-results-daily").status_code, 409)
        self.send_task.assert_not_called()

    def test_staff_cannot_run(self):
        staff = bearer_client(make_user("beat-staff", role="staff"))
        self.assertEqual(self._run("cleanup-task-results-daily", client=staff).status_code, 403)
        self.send_task.assert_not_called()


class WorkerHealthCheckTests(TestCase):
    def test_ping_upserts_heartbeats_and_flags_silent_workers(self):
        from ...core.models import CeleryWorkerStatus
        from ...core.services.celery_tasks import CoreTaskService

        CeleryWorkerStatus.objects.create(
            worker_name="celery@gone",
            status=CeleryWorkerStatus.WorkerStatus.ONLINE,
            last_heartbeat=timezone.now() - timedelta(hours=2),
        )
        with patch.object(CoreTaskService, "ping_workers", return_value=["celery@alive"]):
            report = CoreTaskService.health_check_workers()

        self.assertEqual((report["healthy"], report["unhealthy"]), (1, 1))
        statuses = dict(CeleryWorkerStatus.objects.values_list("worker_name", "status"))
        self.assertEqual(statuses, {"celery@alive": "ONLINE", "celery@gone": "OFFLINE"})
