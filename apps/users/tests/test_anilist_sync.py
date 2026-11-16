"""Linked AniList account, pull-only sync (spec 3 P1-10, D-5): link API, Sync now, daily step."""

from __future__ import annotations

import time
from datetime import timedelta
from unittest.mock import Mock, patch

import httpx
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import UserAnimeList, UserImportJob, UserListLink, UserProfile
from ..services.celery_tasks import UserTaskService
from ..services.import_service import anilist_sync
from ..services.import_service.anilist import AniListImporter
from ..services.import_service.anilist_fetch import USER_MESSAGES, AniListFetchError
from ..services.import_service.base import BaseImporter
from .test_import_service import (
    FakeFetcher,
    ImportTestMixin,
    anilist_row,
    base_module,
    graphql_transport,
    make_anime,
    media_item,
)

User = get_user_model()
JobStatus = UserImportJob.ImportStatus
QUEUE = "apps.users.services.import_job_service.process_import_job.apply_async"


def verified_user(username: str, **fields) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pw", **fields
    )
    UserProfile.objects.update_or_create(user=user, defaults={"email_verified": True})
    user.refresh_from_db()
    return user


class LinkApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = verified_user("linker")
        self.client.force_authenticate(user=self.user)
        self.url = reverse("import_anilist_link")

    def put(self, data):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.put(self.url, data, format="json")

    def test_unlinked_reads_as_not_linked(self):
        response = self.client.get(self.url)
        self.assertEqual((response.status_code, response.data), (200, {"linked": False}))

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))

    def test_invalid_username_and_auto_sync_are_rejected(self):
        self.assertEqual(self.put({"username": "bad name!"}).data["code"], "invalid_username")
        self.assertEqual(self.put({}).data["code"], "missing_username")
        response = self.put({"username": "good", "auto_sync": "yes"})
        self.assertEqual((response.status_code, response.data["code"]), (400, "invalid_auto_sync"))
        self.assertFalse(UserListLink.objects.exists())

    @patch(QUEUE)
    def test_new_link_queues_a_full_import(self, apply_async):
        response = self.put({"username": "RemoteName", "auto_sync": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["linked"])
        self.assertEqual(
            (response.data["username"], response.data["auto_sync"]), ("RemoteName", True)
        )
        job = UserImportJob.objects.get(pk=response.data["job_id"])
        self.assertEqual((job.mode, job.source_identifier), ("full", "RemoteName"))
        self.assertEqual(apply_async.call_args.kwargs["kwargs"], {"job_id": job.pk})
        self.assertIsNone(response.data["import_error"])

    @patch(QUEUE)
    def test_toggling_auto_sync_alone_queues_nothing(self, apply_async):
        UserListLink.objects.create(user=self.user, external_username="RemoteName")
        response = self.put({"username": "remotename", "auto_sync": True})

        self.assertIsNone(response.data["job_id"])
        self.assertFalse(UserImportJob.objects.exists())
        apply_async.assert_not_called()
        self.assertTrue(UserListLink.objects.get().auto_sync)

    @patch(QUEUE)
    def test_renaming_resets_the_cursor_and_imports_again(self, _apply_async):
        UserListLink.objects.create(
            user=self.user, external_username="old", cursor_updated_at=500, external_user_id=9
        )
        response = self.put({"username": "new", "auto_sync": False})
        link = UserListLink.objects.get()
        self.assertIsNotNone(response.data["job_id"])
        self.assertEqual((link.cursor_updated_at, link.external_user_id), (None, None))

    @patch(QUEUE)
    def test_resaving_clears_a_paused_auto_sync(self, _apply_async):
        UserListLink.objects.create(
            user=self.user,
            external_username="name",
            auto_sync=True,
            consecutive_failures=5,
            last_error="private",
        )
        self.assertTrue(self.client.get(self.url).data["auto_sync_paused"])
        response = self.put({"username": "name", "auto_sync": True})
        self.assertFalse(response.data["auto_sync_paused"])
        self.assertEqual(
            (response.data["consecutive_failures"], response.data["last_error"]), (0, "")
        )

    @patch(QUEUE)
    def test_link_saved_even_when_the_import_cannot_start(self, _apply_async):
        UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, status=JobStatus.processing
        )
        response = self.put({"username": "name", "auto_sync": False})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["job_id"])
        self.assertEqual(response.data["import_error"]["code"], "import_already_running")
        self.assertTrue(UserListLink.objects.exists())

    def test_unlink_keeps_the_list(self):
        anime = make_anime(1, anilist_id=1)
        UserAnimeList.objects.create(user=self.user, anime=anime, status="Watching")
        UserListLink.objects.create(user=self.user, external_username="name")

        response = self.client.delete(self.url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(UserListLink.objects.exists())
        self.assertTrue(UserAnimeList.objects.filter(user=self.user).exists())

    def test_get_reports_the_last_job(self):
        UserListLink.objects.create(user=self.user, external_username="name")
        job = UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, status=JobStatus.completed
        )
        self.assertEqual(self.client.get(self.url).data["last_job"]["id"], job.pk)


class SyncNowApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = verified_user("syncer")
        self.client.force_authenticate(user=self.user)
        self.url = reverse("import_anilist_sync")

    def post(self):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(self.url)

    def test_not_linked_is_404(self):
        response = self.post()
        self.assertEqual((response.status_code, response.data["code"]), (404, "anilist_not_linked"))

    @patch(QUEUE)
    def test_sync_queues_an_incremental_job_then_cools_down(self, apply_async):
        UserListLink.objects.create(user=self.user, external_username="name")

        first = self.post()
        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED)
        job = UserImportJob.objects.get(pk=first.data["job_id"])
        self.assertEqual((job.mode, job.source_identifier), ("incremental", "name"))
        UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.completed)

        second = self.post()
        self.assertEqual((second.status_code, second.data["code"]), (429, "sync_cooldown"))
        self.assertEqual(apply_async.call_count, 1)
        self.assertIsNotNone(
            self.client.get(reverse("import_anilist_link")).data["sync_available_at"]
        )

    def test_cooldown_service_result_carries_retry_after(self):
        UserListLink.objects.create(user=self.user, external_username="name")
        cache.add(anilist_sync._cooldown_key(self.user.id), time.time() + 600, timeout=600)
        result = anilist_sync.request_sync(self.user)
        self.assertEqual(result.status_code, 429)
        self.assertTrue(0 < result.payload["retry_after"] <= anilist_sync.SYNC_COOLDOWN_SECONDS)

    def test_cooldown_response_carries_retry_after(self):
        UserListLink.objects.create(user=self.user, external_username="name")
        cache.add(anilist_sync._cooldown_key(self.user.id), time.time() + 600, timeout=600)
        response = self.post()
        self.assertEqual((response.status_code, response.data["code"]), (429, "sync_cooldown"))
        self.assertGreater(response.data["retry_after"], 0)
        self.assertEqual(response["Retry-After"], str(response.data["retry_after"]))

    @patch(QUEUE)
    def test_refused_job_does_not_start_the_cooldown(self, _apply_async):
        UserListLink.objects.create(user=self.user, external_username="name")
        running = UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, status=JobStatus.processing
        )
        response = self.post()
        self.assertEqual(
            (response.status_code, response.data["code"]), (429, "import_already_running")
        )

        UserImportJob.objects.filter(pk=running.pk).update(status=JobStatus.completed)
        self.assertEqual(self.post().status_code, status.HTTP_202_ACCEPTED)


class IncrementalSyncTests(ImportTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.link = UserListLink.objects.create(
            user=self.user, external_username="remote-name", cursor_updated_at=200
        )

    def test_fetcher_stops_at_the_first_entry_not_newer_than_the_cursor(self):
        def handler(query, variables):
            self.assertIn("UPDATED_TIME_DESC", query)
            rows = [
                anilist_row(1, updated=300),
                anilist_row(2, updated=200),
                anilist_row(3, updated=100),
            ]
            return {"Page": {"pageInfo": {"hasNextPage": True}, "mediaList": rows}}

        fetcher, requests = graphql_transport(handler)
        rows = fetcher.fetch_recent_entries("remote-name", since=200)
        self.assertEqual([row["mediaId"] for row in rows], [1])
        self.assertEqual(len(requests), 1)  # the next page is never asked for

    def test_cancel_stops_the_incremental_download_between_pages(self):
        job = self.make_job(mode=UserImportJob.ImportMode.incremental)
        pages = []

        def handler(query, variables):
            pages.append(variables["page"])
            UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.cancelled)
            rows = [anilist_row(variables["page"], updated=1000 - variables["page"])]
            return {"Page": {"pageInfo": {"hasNextPage": True}, "mediaList": rows}}

        fetcher, _ = graphql_transport(handler)
        result = AniListImporter(job, "remote-name", fetcher=fetcher).run()

        self.assertEqual((result["outcome"], pages), ("cancelled", [1]))

    def test_fetcher_follows_pages_until_the_cursor(self):
        pages = [
            {
                "Page": {
                    "pageInfo": {"hasNextPage": True},
                    "mediaList": [anilist_row(1, updated=500)],
                }
            },
            {
                "Page": {
                    "pageInfo": {"hasNextPage": False},
                    "mediaList": [anilist_row(2, updated=400)],
                }
            },
        ]
        fetcher, requests = graphql_transport(lambda q, v: pages[v["page"] - 1])
        rows = fetcher.fetch_recent_entries("remote-name", since=None)
        self.assertEqual(([r["mediaId"] for r in rows], len(requests)), ([1, 2], 2))

    def test_incremental_job_uses_the_cursor_and_advances_it(self):
        make_anime(1, anilist_id=11)
        fetcher = FakeFetcher(recent=[anilist_row(11, updated=900, progress=2)])
        _job, result = self.run_anilist(fetcher, mode=UserImportJob.ImportMode.incremental)

        self.assertEqual(fetcher.calls, ["recent:200"])
        self.assertEqual(result["outcome"], "completed")
        self.link.refresh_from_db()
        self.assertEqual(self.link.cursor_updated_at, 900)
        self.assertIsNotNone(self.link.last_synced_at)
        self.assertEqual((self.link.consecutive_failures, self.link.last_error), (0, ""))

    def test_no_changes_keeps_the_cursor(self):
        job, _ = self.run_anilist(FakeFetcher(recent=[]), mode=UserImportJob.ImportMode.incremental)
        self.link.refresh_from_db()
        self.assertEqual(self.link.cursor_updated_at, 200)
        self.assertEqual(job.status, JobStatus.completed)

    def test_incremental_without_a_cursor_reads_the_whole_list(self):
        UserListLink.objects.filter(pk=self.link.pk).update(cursor_updated_at=None)
        fetcher = FakeFetcher([anilist_row(11, updated=50)], user_id=4242)
        self.run_anilist(fetcher, mode=UserImportJob.ImportMode.incremental)
        self.link.refresh_from_db()
        self.assertEqual(fetcher.calls, ["collection"])
        self.assertEqual((self.link.cursor_updated_at, self.link.external_user_id), (50, 4242))

    def test_failure_counts_a_strike_and_keeps_the_reason(self):
        fetcher, _ = graphql_transport(
            lambda q, v: httpx.Response(404, json={"errors": [{"message": "Private User"}]})
        )
        UserListLink.objects.filter(pk=self.link.pk).update(consecutive_failures=2)
        job, _ = self.run_anilist(fetcher, mode=UserImportJob.ImportMode.incremental)
        self.link.refresh_from_db()
        self.assertEqual(self.link.consecutive_failures, 3)
        self.assertEqual(self.link.last_error, USER_MESSAGES["private"])
        self.assertEqual(job.failure_reason, USER_MESSAGES["private"])

    def test_an_import_of_another_name_leaves_the_link_alone(self):
        job = self.make_job(source_identifier="someone-else")
        AniListImporter(
            job, "someone-else", fetcher=FakeFetcher([anilist_row(1, updated=999)])
        ).run()
        self.link.refresh_from_db()
        self.assertEqual(self.link.cursor_updated_at, 200)


class DailySyncTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()

    def link(self, name, *, auto_sync=True, seen_days_ago=1, failures=0, synced=None):
        user = User.objects.create_user(
            username=name,
            email=f"{name}@example.com",
            password="pw",
            last_login=self.now - timedelta(days=seen_days_ago),
        )
        return UserListLink.objects.create(
            user=user,
            external_username=name,
            auto_sync=auto_sync,
            consecutive_failures=failures,
            last_synced_at=synced,
        )

    def test_due_links_filters_opt_in_recent_and_healthy(self):
        due = self.link("due")
        self.link("off", auto_sync=False)
        self.link("idle", seen_days_ago=20)
        self.link("broken", failures=5)
        self.assertEqual(list(anilist_sync.due_links()), [due])

    def test_due_links_cap_takes_the_longest_unsynced_first(self):
        recent = self.link("recent", synced=self.now - timedelta(hours=1))
        never = self.link("never")
        older = self.link("older", synced=self.now - timedelta(days=2))
        with patch.object(anilist_sync, "ANILIST_DAILY_SYNC_MAX_LINKS", 2):
            self.assertEqual(list(anilist_sync.due_links()), [never, older])
        self.assertIn(recent, list(anilist_sync.due_links()))

    def test_sync_runs_each_link_and_skips_owners_with_a_running_import(self):
        ok = self.link("ok")
        busy = self.link("busy")
        bad = self.link("bad")
        UserImportJob.objects.create(
            user=busy.user, source=UserImportJob.ImportSource.anilist, status=JobStatus.processing
        )
        ran = []

        def factory(job, link):
            ran.append(link.external_username)
            importer = Mock()
            importer.run.return_value = {"outcome": "completed" if link == ok else "failed"}
            if link == bad:
                importer.run.side_effect = RuntimeError("boom")
            return importer

        counts = anilist_sync.sync_linked_lists(importer_factory=factory)

        self.assertEqual(counts, {"synced": 1, "failed": 1, "skipped": 1})
        self.assertEqual(sorted(ran), ["bad", "ok"])
        job = UserImportJob.objects.get(user=ok.user)
        self.assertEqual((job.mode, job.source_identifier), ("incremental", "ok"))

    def test_maintenance_workflow_queues_the_daily_sync(self):
        base = "apps.users.tasks"
        with (
            patch(f"{base}.cleanup_unverified_accounts.delay", return_value=Mock(id="a")),
            patch(f"{base}.cleanup_old_import_jobs.delay", return_value=Mock(id="b")),
            patch(
                f"{base}.sync_linked_anilist_lists.apply_async", return_value=Mock(id="c")
            ) as sync,
        ):
            result = UserTaskService.run_user_maintenance_workflow()
            sync.assert_called_once_with(queue="low_priority")
            self.assertEqual(result["task_ids"]["anilist_sync"], "c")

            sync.reset_mock()
            UserTaskService.run_user_maintenance_workflow(sync_anilist=False)
            sync.assert_not_called()

    def test_beat_kwargs_are_unchanged(self):
        from root.settings.celery_schedule import _list_entries

        entry = _list_entries()["user-maintenance-daily"]
        self.assertEqual(
            entry["kwargs"],
            {
                "cleanup_unverified": True,
                "cleanup_imports": True,
                "unverified_days": 7,
                "import_days": 30,
            },
        )
        self.assertEqual(entry["options"], {"queue": "low_priority"})


class CursorTests(ImportTestMixin, TestCase):
    """The incremental cursor never moves past an entry left for later (council M2)."""

    def setUp(self):
        super().setUp()
        self.link = UserListLink.objects.create(
            user=self.user, external_username="remote-name", cursor_updated_at=200
        )
        make_anime(1, anilist_id=11)

    def sync(self, fetcher):
        job, result = self.run_anilist(fetcher, mode=UserImportJob.ImportMode.incremental)
        self.link.refresh_from_db()
        return job, result

    def test_entry_past_the_catalog_cap_holds_the_cursor_below_it(self):
        rows = [anilist_row(11, updated=900, progress=1), anilist_row(55, updated=800)]
        with patch.object(BaseImporter, "MAX_UNKNOWN_FETCHES", 0):
            _job, result = self.sync(FakeFetcher(recent=rows))

        self.assertEqual(result["outcome"], "completed")
        self.assertEqual(self.link.cursor_updated_at, 799)

    def test_anilist_busy_during_the_catalog_fetch_holds_the_cursor(self):
        fetcher = FakeFetcher(recent=[anilist_row(11, updated=900), anilist_row(55, updated=850)])

        def busy(**_ids):
            raise AniListFetchError("rate_limited", "busy")
            yield  # pragma: no cover - makes this a generator like the real one

        fetcher.fetch_media_by_ids = busy
        self.sync(fetcher)

        self.assertEqual(self.link.cursor_updated_at, 849)

    def test_titles_anilist_does_not_have_do_not_hold_the_cursor(self):
        rows = [anilist_row(11, updated=900), anilist_row(55, updated=800)]
        self.sync(FakeFetcher(recent=rows))  # 55 is fetched and not found: permanent

        self.assertEqual(self.link.cursor_updated_at, 900)

    def test_a_list_larger_than_the_cap_still_moves_the_cursor_forward(self):
        # Council round 2 (N1): the cap keeps the oldest changes, so the cursor held
        # below the newest leftovers advances on every run instead of stalling.
        make_anime(2, anilist_id=12)
        make_anime(3, anilist_id=13)
        newest_first = [
            anilist_row(13, updated=700),
            anilist_row(12, updated=500),
            anilist_row(11, updated=300),
        ]
        with override_settings(MAX_IMPORT_XML_ENTRIES=1):
            self.sync(FakeFetcher(recent=newest_first))
            self.assertEqual(self.link.cursor_updated_at, 300)  # 11 applied, 12 and 13 held
            self.sync(FakeFetcher(recent=newest_first[:2]))
            self.assertEqual(self.link.cursor_updated_at, 500)  # 12 applied, 13 held
            self.sync(FakeFetcher(recent=newest_first[:1]))
            self.assertEqual(self.link.cursor_updated_at, 700)

    def test_a_payload_the_catalog_rejects_does_not_hold_the_cursor(self):
        rows = [anilist_row(11, updated=900), anilist_row(55, updated=800)]
        fetcher = FakeFetcher(recent=rows, media=[media_item(55)])
        with patch.object(base_module, "save_media", side_effect=ValueError("no title")):
            self.sync(fetcher)

        self.assertEqual(self.link.cursor_updated_at, 900)

    def test_cursor_never_goes_back(self):
        rows = [anilist_row(55, updated=201)]
        with patch.object(BaseImporter, "MAX_UNKNOWN_FETCHES", 0):
            self.sync(FakeFetcher(recent=rows))

        self.assertEqual(self.link.cursor_updated_at, 200)

    @patch("apps.users.services.import_service.anilist_fetch.time.sleep")
    def test_anilist_outage_is_reported_but_not_counted_as_a_strike(self, _sleep):
        fetcher, _ = graphql_transport(lambda q, v: httpx.Response(503, json={}))
        UserListLink.objects.filter(pk=self.link.pk).update(consecutive_failures=2)
        job, _ = self.sync(fetcher)

        self.assertEqual(job.status, JobStatus.failed)
        self.assertEqual(self.link.consecutive_failures, 2)
        self.assertEqual(self.link.last_error, USER_MESSAGES["unavailable"])


class DailySyncFailureTests(TestCase):
    def test_a_crashed_sync_job_is_failed_not_left_processing(self):
        user = User.objects.create_user(username="crash", email="crash@example.com", password="x")
        User.objects.filter(pk=user.pk).update(last_login=timezone.now())
        UserListLink.objects.create(user=user, external_username="crash", auto_sync=True)

        def factory(job, link):
            importer = Mock()
            importer.run.side_effect = RuntimeError("boom")
            return importer

        anilist_sync.sync_linked_lists(importer_factory=factory)

        job = UserImportJob.objects.get(user=user)
        self.assertEqual(job.status, JobStatus.failed)
        self.assertTrue(job.failure_reason)
