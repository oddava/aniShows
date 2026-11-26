"""List imports (spec 3 P0-3/P0-4/P0-5/P1-3/P1-4): mapping, merge, batching, lifecycle, API.

Every network call is faked: importers get a fake fetcher, or a real ``AniListFetcher``
/ MAL client over ``httpx.MockTransport``; nothing reaches AniList or MyAnimeList.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import Mock, patch

import httpx
from celery.exceptions import Retry, SoftTimeLimitExceeded
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.utils import OperationalError
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ...animes.models import Anime
from ..models import UserAnimeList, UserImportJob, UserProfile
from ..services.celery_tasks import UserTaskService
from ..services.import_job_service import (
    cancel_import_job,
    create_mal_import_job,
    create_mal_xml_import_job,
)
from ..services.import_service import ImportService
from ..services.import_service import base as base_module
from ..services.import_service.anilist import AniListImporter
from ..services.import_service.anilist_fetch import (
    USER_MESSAGES,
    AniListFetcher,
    AniListFetchError,
)
from ..services.import_service.base import BaseImporter
from ..services.import_service.entries import (
    REASON_NOT_FOUND,
    REASON_NOT_IN_CATALOG_YET,
    REASON_UNKNOWN_STATUS,
    ImportedEntry,
    anilist_entry,
    fuzzy_date,
    mal_date,
    score_from_point_100,
)
from ..services.import_service.mal_api import MyAnimeListAPIImporter
from ..services.import_service.mal_xml import (
    MAX_XML_DECOMPRESSED_BYTES,
    MyAnimeListXMLImporter,
    XMLImportError,
    parse_mal_xml,
    read_upload,
)
from ..tasks import process_import_job

User = get_user_model()
Status = UserAnimeList.UserAnimeStatus
JobStatus = UserImportJob.ImportStatus


# --------------------------------------------------------------------------- helpers


def make_anime(n: int, *, anilist_id=None, mal_id=None, episodes=12, title=None) -> Anime:
    return Anime.objects.create(
        title=title or f"Import Anime {n}",
        slug=f"import-anime-{n}",
        synopsis="",
        episode_count=episodes,
        anilist_id=anilist_id,
        mal_id=mal_id,
    )


def anilist_row(media_id, *, status="CURRENT", score=0, progress=0, updated=None, **extra):
    row = {
        "mediaId": media_id,
        "status": status,
        "score": score,
        "progress": progress,
        "repeat": extra.pop("repeat", 0),
        "notes": extra.pop("notes", None),
        "updatedAt": updated,
        "startedAt": extra.pop("startedAt", {"year": None, "month": None, "day": None}),
        "completedAt": extra.pop("completedAt", {"year": None, "month": None, "day": None}),
        "media": {
            "id": media_id,
            "idMal": extra.pop("idMal", None),
            "episodes": 12,
            "title": {"romaji": extra.pop("title", f"Media {media_id}")},
        },
    }
    row.update(extra)
    return row


def media_item(media_id, mal_id=None):
    return {"id": media_id, "idMal": mal_id, "episodes": 12, "title": {"romaji": f"M{media_id}"}}


def fake_save_media(_service, item):
    return Anime.objects.create(
        title=item["title"]["romaji"],
        slug=f"fetched-{item['id']}",
        synopsis="",
        episode_count=item.get("episodes") or 0,
        anilist_id=item["id"],
        mal_id=item.get("idMal"),
    )


class FakeFetcher:
    """Stands in for ``AniListFetcher``; records what the importer asked for."""

    def __init__(self, rows=(), *, media=(), recent=None, user_id=None, on_page=None):
        self.rows = list(rows)
        self.recent = recent
        self.media = {item["id"]: item for item in media}
        self.user_id = user_id
        self.on_page = on_page
        self.pages_requested = 0
        self.calls: list[str] = []

    def fetch_list_collection(self, username):
        self.calls.append("collection")
        return self.rows, self.user_id

    def fetch_recent_entries(self, username, *, since, on_page=None):
        self.calls.append(f"recent:{since}")
        return self.recent if self.recent is not None else self.rows

    def fetch_media_by_ids(self, *, anilist_ids=(), mal_ids=()):
        ids = list(anilist_ids)
        for start in range(0, len(ids), 25):
            self.pages_requested += 1
            if self.on_page:
                self.on_page(self.pages_requested)
            yield [self.media[i] for i in ids[start : start + 25] if i in self.media]

    def close(self):
        pass


def graphql_transport(handler):
    """A real ``AniListFetcher`` over a mock transport; ``handler(query, variables)``."""
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        result = handler(body["query"], body["variables"])
        if isinstance(result, httpx.Response):
            return result
        return httpx.Response(200, json={"data": result})

    fetcher = AniListFetcher(
        client=httpx.Client(transport=httpx.MockTransport(respond)), limiter=Mock()
    )
    return fetcher, requests


if TYPE_CHECKING:
    _MixinBase = TestCase
else:
    _MixinBase = object


class ImportTestMixin(_MixinBase):
    # Most tests stub the post-import refresh; the refresh tests turn this off.
    patch_refresh = True

    def setUp(self):
        super().setUp()
        cache.clear()
        self.user = User.objects.create_user(
            username="importer", email="importer@example.com", password="pw"
        )
        patches = [
            patch.object(base_module, "save_media", side_effect=fake_save_media),
            patch.object(BaseImporter, "_get_persistence", return_value=None),
        ]
        if self.patch_refresh:
            patches.append(patch.object(BaseImporter, "refresh_derived_data"))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def make_job(self, source=UserImportJob.ImportSource.anilist, **fields):
        fields.setdefault("source_identifier", "remote-name")
        return UserImportJob.objects.create(
            user=self.user, source=source, status=JobStatus.processing, **fields
        )

    def run_anilist(self, fetcher, **job_fields):
        job = self.make_job(**job_fields)
        result = AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()
        return job, result


# --------------------------------------------------------------------------- mapping


class EntryMappingTests(TestCase):
    def test_point_100_scores_round_half_up_to_ten(self):
        self.assertEqual(score_from_point_100(75), 8)
        self.assertEqual(score_from_point_100(5), 1)  # 5/100 is not 5/10
        self.assertEqual(score_from_point_100(0), 0)
        self.assertEqual(score_from_point_100(None), 0)
        self.assertEqual(score_from_point_100(100), 10)
        # A POINT_5 list rated 4 stars arrives as 80 with format: POINT_100.
        self.assertEqual(score_from_point_100(80), 8)
        self.assertEqual(score_from_point_100(73.5), 7)

    def test_anilist_row_maps_dates_rewatch_notes_and_timestamp(self):
        entry = anilist_entry(
            anilist_row(
                9,
                status="REPEATING",
                score=90,
                progress=3,
                updated=1_700_000_000,
                repeat=2,
                notes="again",
                idMal=99,
                startedAt={"year": 2020, "month": 1, "day": 5},
                completedAt={"year": 2020, "month": 2, "day": None},
            )
        )
        self.assertEqual(entry.status, Status.watching)
        self.assertTrue(entry.is_rewatching)
        self.assertEqual((entry.anilist_id, entry.mal_id, entry.score), (9, 99, 9))
        self.assertEqual(entry.started, date(2020, 1, 5))
        self.assertIsNone(entry.finished)  # a missing day means unknown
        self.assertEqual((entry.repeat, entry.notes), (2, "again"))
        self.assertEqual(entry.remote_updated_at, datetime.fromtimestamp(1_700_000_000, tz=UTC))

    def test_unknown_anilist_status_maps_to_none(self):
        self.assertIsNone(anilist_entry(anilist_row(1, status="WEIRD")).status)

    def test_date_parsers(self):
        self.assertIsNone(mal_date("0000-00-00"))
        self.assertIsNone(mal_date("2020-05-00"))
        self.assertEqual(mal_date("2020-05-17"), date(2020, 5, 17))
        self.assertIsNone(fuzzy_date(None))

    def test_payload_round_trip(self):
        entry = ImportedEntry(
            status=Status.completed,
            title="T",
            mal_id=3,
            started=date(2021, 1, 1),
            remote_updated_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        self.assertEqual(ImportedEntry.from_payload(entry.to_payload()), entry)


class AniListFetcherTests(TestCase):
    @patch("apps.users.services.import_service.anilist_fetch.time.sleep")
    def test_collection_skips_custom_lists_and_dedupes_by_media_id(self, _sleep):
        def handler(query, variables):
            self.assertIn("score(format: POINT_100)", query)
            return {
                "MediaListCollection": {
                    "user": {"id": 77},
                    "lists": [
                        {"isCustomList": False, "entries": [anilist_row(1), anilist_row(2)]},
                        {"isCustomList": True, "entries": [anilist_row(1), anilist_row(3)]},
                        {"isCustomList": False, "entries": [anilist_row(2)]},
                    ],
                }
            }

        fetcher, _ = graphql_transport(handler)
        rows, user_id = fetcher.fetch_list_collection("someone")
        self.assertEqual([row["mediaId"] for row in rows], [1, 2])
        self.assertEqual(user_id, 77)

    @patch("apps.users.services.import_service.anilist_fetch.time.sleep")
    def test_media_by_ids_fetches_lean_pages_of_50(self, _sleep):
        def handler(query, variables):
            self.assertIn("id_in", query)
            self.assertNotIn("characterPreview", query)  # the cast comes from the details lane
            self.assertLessEqual(len(variables["ids"]), 50)
            return {"Page": {"media": [media_item(i) for i in variables["ids"]]}}

        fetcher, requests = graphql_transport(handler)
        pages = list(fetcher.fetch_media_by_ids(anilist_ids=list(range(1, 61))))
        self.assertEqual(len(requests), 2)
        self.assertEqual([len(page) for page in pages], [50, 10])

    @patch("apps.users.services.import_service.anilist_fetch.time.sleep")
    def test_rate_limit_pauses_every_worker_and_retries(self, _sleep):
        answers = [
            httpx.Response(429, headers={"Retry-After": "3"}, json={"errors": []}),
            {"Page": {"media": []}},
        ]
        fetcher, _ = graphql_transport(lambda q, v: answers.pop(0))
        fetcher.run_query("query X { a }", {})
        fetcher._limiter.pause.assert_called_once_with(3.0)
        self.assertEqual(fetcher._limiter.acquire.call_count, 2)

    def test_private_and_unknown_users_map_to_codes(self):
        for message, code in (("Private User", "private"), ("User not found", "not_found")):
            fetcher, _ = graphql_transport(
                lambda q, v, m=message: httpx.Response(
                    404, json={"errors": [{"message": m, "status": 404}], "data": None}
                )
            )
            with self.assertRaises(AniListFetchError) as ctx:
                fetcher.fetch_list_collection("someone")
            self.assertEqual(ctx.exception.code, code)


# --------------------------------------------------------------------------- pipeline


class ImportPipelineTests(ImportTestMixin, TestCase):
    def test_creates_new_entries_with_scaled_scores_and_dates(self):
        anime = make_anime(1, anilist_id=101)
        fetcher = FakeFetcher(
            [
                anilist_row(
                    101,
                    status="COMPLETED",
                    score=75,
                    progress=12,
                    updated=1_700_000_000,
                    repeat=1,
                    notes="great",
                    startedAt={"year": 2023, "month": 1, "day": 2},
                    completedAt={"year": 2023, "month": 3, "day": 4},
                )
            ]
        )
        job, result = self.run_anilist(fetcher)

        self.assertEqual(job.status, JobStatus.completed)
        self.assertEqual((job.imported_entries, job.total_entries), (1, 1))
        entry = UserAnimeList.objects.get(user=self.user, anime=anime)
        self.assertEqual((entry.status, entry.score, entry.episodes_watched), ("Completed", 8, 12))
        self.assertEqual(
            (entry.started_at, entry.finished_at), (date(2023, 1, 2), date(2023, 3, 4))
        )
        self.assertEqual((entry.total_rewatches, entry.notes), (1, "great"))
        self.assertEqual(result["outcome"], "completed")

    def test_import_never_invents_dates(self):
        anime = make_anime(1, anilist_id=101)
        self.run_anilist(FakeFetcher([anilist_row(101, status="CURRENT", progress=3)]))
        entry = UserAnimeList.objects.get(user=self.user, anime=anime)
        self.assertEqual((entry.started_at, entry.finished_at), (None, None))

    def test_progress_is_clamped_to_the_known_episode_count(self):
        anime = make_anime(1, anilist_id=101, episodes=12)
        self.run_anilist(FakeFetcher([anilist_row(101, status="CURRENT", progress=40)]))
        entry = UserAnimeList.objects.get(user=self.user, anime=anime)
        self.assertEqual((entry.episodes_watched, entry.status), (12, "Completed"))

    def test_remote_newer_than_local_edit_is_applied(self):
        anime = make_anime(1, anilist_id=101)
        local = UserAnimeList.objects.create(
            user=self.user, anime=anime, status=Status.watching, episodes_watched=2, score=5
        )
        UserAnimeList.objects.filter(pk=local.pk).update(
            updated_at=timezone.now() - timedelta(days=2)
        )
        updated = int((timezone.now() - timedelta(days=1)).timestamp())
        job, _ = self.run_anilist(
            FakeFetcher([anilist_row(101, status="PAUSED", progress=6, score=90, updated=updated)])
        )
        local.refresh_from_db()
        self.assertEqual((local.status, local.episodes_watched, local.score), ("On Hold", 6, 9))
        self.assertEqual(job.imported_entries, 1)

    def test_an_edit_made_while_the_import_runs_is_kept(self):
        # The merge read the row, then the user saved a new score and note before the
        # batch was written: the user's version wins (council finding).
        anime = make_anime(1, anilist_id=101)
        local = UserAnimeList.objects.create(
            user=self.user, anime=anime, status=Status.watching, episodes_watched=2, score=5
        )
        UserAnimeList.objects.filter(pk=local.pk).update(
            updated_at=timezone.now() - timedelta(days=2)
        )
        real_write = BaseImporter.write_pending

        def user_edits_first(importer, **kwargs):
            UserAnimeList.objects.filter(pk=local.pk).update(
                score=9, notes="mine", updated_at=timezone.now()
            )
            return real_write(importer, **kwargs)

        updated = int((timezone.now() - timedelta(days=1)).timestamp())
        with patch.object(BaseImporter, "write_pending", user_edits_first):
            job, _ = self.run_anilist(FakeFetcher([anilist_row(101, score=60, updated=updated)]))

        local.refresh_from_db()
        self.assertEqual((local.score, local.notes), (9, "mine"))
        self.assertEqual((job.imported_entries, job.skipped_entries), (0, 1))

    def test_local_edit_newer_than_remote_is_kept(self):
        anime = make_anime(1, anilist_id=101)
        local = UserAnimeList.objects.create(
            user=self.user, anime=anime, status=Status.watching, episodes_watched=2, score=5
        )
        updated = int((timezone.now() - timedelta(days=3)).timestamp())
        job, _ = self.run_anilist(
            FakeFetcher([anilist_row(101, status="DROPPED", progress=9, score=10, updated=updated)])
        )
        local.refresh_from_db()
        self.assertEqual((local.status, local.episodes_watched, local.score), ("Watching", 2, 5))
        self.assertEqual((job.skipped_entries, job.imported_entries), (1, 0))

    def test_remote_zero_score_never_clears_local_score(self):
        anime = make_anime(1, anilist_id=101)
        local = UserAnimeList.objects.create(
            user=self.user, anime=anime, status=Status.watching, episodes_watched=2, score=7
        )
        UserAnimeList.objects.filter(pk=local.pk).update(
            updated_at=timezone.now() - timedelta(days=2)
        )
        updated = int(timezone.now().timestamp())
        self.run_anilist(FakeFetcher([anilist_row(101, progress=4, score=0, updated=updated)]))
        local.refresh_from_db()
        self.assertEqual((local.score, local.episodes_watched), (7, 4))

    def test_xml_without_timestamp_fills_only_empty_fields(self):
        anime = make_anime(1, mal_id=55)
        local = UserAnimeList.objects.create(
            user=self.user, anime=anime, status=Status.watching, episodes_watched=4, score=7
        )
        job = self.make_job(
            source=UserImportJob.ImportSource.myanimelist_xml,
            payload={
                "entries": [
                    ImportedEntry(
                        status=Status.dropped,
                        mal_id=55,
                        title="X",
                        score=9,
                        progress=10,
                        notes="from xml",
                        started=date(2022, 1, 1),
                    ).to_payload()
                ]
            },
        )
        MyAnimeListXMLImporter(job).run()
        local.refresh_from_db()
        self.assertEqual((local.status, local.score, local.episodes_watched), ("Watching", 7, 4))
        self.assertEqual((local.notes, local.started_at), ("from xml", date(2022, 1, 1)))

    def test_xml_start_date_never_moves_a_stored_finish_date(self):
        # Council round 2: local finish 2020-05-01, no start; the XML says it started in
        # 2022. The contradicting incoming date is dropped, the stored one stays.
        anime = make_anime(1, mal_id=55)
        local = UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=Status.completed,
            episodes_watched=12,
            finished_at=date(2020, 5, 1),
        )
        entry = ImportedEntry(
            status=Status.completed, mal_id=55, title="X", progress=12, started=date(2022, 1, 1)
        )
        job = self.make_job(
            source=UserImportJob.ImportSource.myanimelist_xml,
            payload={"entries": [entry.to_payload()]},
        )
        MyAnimeListXMLImporter(job).run()
        local.refresh_from_db()
        self.assertEqual((local.started_at, local.finished_at), (None, date(2020, 5, 1)))

    def test_newer_remote_start_date_wins_over_a_contradicting_local_finish(self):
        anime = make_anime(1, anilist_id=101)
        local = UserAnimeList.objects.create(
            user=self.user,
            anime=anime,
            status=Status.completed,
            episodes_watched=12,
            started_at=date(2020, 1, 1),
            finished_at=date(2020, 5, 1),
        )
        UserAnimeList.objects.filter(pk=local.pk).update(
            updated_at=timezone.now() - timedelta(days=2)
        )
        updated = int((timezone.now() - timedelta(days=1)).timestamp())
        row = anilist_row(
            101, progress=3, updated=updated, startedAt={"year": 2024, "month": 2, "day": 1}
        )
        self.run_anilist(FakeFetcher([row]))

        local.refresh_from_db()
        self.assertEqual(
            (local.status, local.started_at, local.finished_at),
            (Status.watching, date(2024, 2, 1), None),
        )

    def test_title_is_used_only_without_stable_ids(self):
        make_anime(1, anilist_id=101, title="Shared Title")
        make_anime(2, anilist_id=102, title="shared title")  # duplicates must not crash
        job = self.make_job(
            source=UserImportJob.ImportSource.myanimelist_xml,
            payload={
                "entries": [
                    ImportedEntry(status=Status.watching, title="Shared Title").to_payload(),
                    # Has an id that is not in the catalog: never bound by its title.
                    ImportedEntry(
                        status=Status.watching, title="Shared Title", mal_id=999
                    ).to_payload(),
                ]
            },
        )
        fetcher = FakeFetcher()
        MyAnimeListXMLImporter(job, fetcher=fetcher).run()
        job.refresh_from_db()
        rows = UserAnimeList.objects.filter(user=self.user)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().anime.anilist_id, 101)  # lowest id among title matches
        self.assertEqual(job.unmatched[0]["mal_id"], 999)

    def test_unknown_ids_are_fetched_in_batches(self):
        rows = [anilist_row(i) for i in range(1, 61)]
        fetcher = FakeFetcher(rows, media=[media_item(i) for i in range(1, 61)])
        job, _ = self.run_anilist(fetcher)
        self.assertEqual(fetcher.pages_requested, 3)
        self.assertEqual((job.fetched_entries, job.imported_entries), (60, 60))
        self.assertEqual(UserAnimeList.objects.filter(user=self.user).count(), 60)

    def test_unknown_cap_reports_not_in_catalog_yet(self):
        rows = [anilist_row(i) for i in range(1, 6)]
        with patch.object(BaseImporter, "MAX_UNKNOWN_FETCHES", 2):
            job, _ = self.run_anilist(FakeFetcher(rows, media=[media_item(1)]))
        reasons = sorted(item["reason"] for item in job.unmatched)
        self.assertEqual(reasons, [REASON_NOT_FOUND] + [REASON_NOT_IN_CATALOG_YET] * 3)
        self.assertEqual((job.imported_entries, job.failed_entries), (1, 4))

    def test_ids_known_missing_are_not_fetched_again(self):
        self.run_anilist(FakeFetcher([anilist_row(5)]))  # not found → remembered
        fetcher = FakeFetcher([anilist_row(5)], media=[media_item(5)])
        job, _ = self.run_anilist(fetcher)
        self.assertEqual(fetcher.pages_requested, 0)
        self.assertEqual(job.unmatched[0]["reason"], REASON_NOT_FOUND)

    def test_unknown_status_is_reported_unmatched(self):
        make_anime(1, anilist_id=101)
        job, _ = self.run_anilist(FakeFetcher([anilist_row(101, status="WEIRD")]))
        self.assertEqual(job.unmatched[0]["reason"], REASON_UNKNOWN_STATUS)
        self.assertEqual(job.failed_entries, 1)

    def test_duplicate_rows_are_processed_once(self):
        make_anime(1, anilist_id=101)
        job, _ = self.run_anilist(FakeFetcher([anilist_row(101), anilist_row(101)]))
        self.assertEqual((job.total_entries, job.imported_entries), (1, 1))

    def test_import_of_100_known_entries_stays_within_query_budget(self):
        for n in range(100):
            make_anime(n, anilist_id=1000 + n)
        job = self.make_job()
        importer = AniListImporter(
            job, "remote-name", fetcher=FakeFetcher([anilist_row(1000 + n) for n in range(100)])
        )
        with CaptureQueriesContext(connection) as ctx:
            importer.run()
        self.assertLessEqual(len(ctx.captured_queries), 15, [q["sql"] for q in ctx])
        self.assertEqual(UserAnimeList.objects.filter(user=self.user).count(), 100)


class ImportLifecycleTests(ImportTestMixin, TestCase):
    def test_cancel_during_fetch_stops_and_never_completes(self):
        def cancel_on_first_page(page):
            if page == 1:
                UserImportJob.objects.filter(pk=self.job_pk).update(status=JobStatus.cancelled)

        rows = [anilist_row(i) for i in range(1, 61)]
        fetcher = FakeFetcher(
            rows, media=[media_item(i) for i in range(1, 61)], on_page=cancel_on_first_page
        )
        job = self.make_job()
        self.job_pk = job.pk
        result = AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()

        self.assertEqual(result["outcome"], "cancelled")
        self.assertEqual(job.status, JobStatus.cancelled)
        self.assertEqual(fetcher.pages_requested, 1)  # stopped at the next flush
        self.assertEqual(UserAnimeList.objects.filter(user=self.user).count(), 0)

    def test_cancel_during_the_merge_writes_nothing_after_it(self):
        for n in range(25):
            make_anime(100 + n, anilist_id=1000 + n)
        rows = [anilist_row(1000 + n, progress=1) for n in range(25)]
        job = self.make_job()
        real_merge = BaseImporter.merge

        def cancel_after_first(importer, entry, anime, local):
            real_merge(importer, entry, anime, local)
            if importer.imported_count == 1:
                UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.cancelled)

        with patch.object(BaseImporter, "merge", cancel_after_first):
            result = AniListImporter(job, "remote-name", fetcher=FakeFetcher(rows)).run()

        job.refresh_from_db()
        self.assertEqual((result["outcome"], job.status), ("cancelled", JobStatus.cancelled))
        self.assertFalse(UserAnimeList.objects.filter(user=self.user).exists())
        self.assertEqual(job.imported_entries, 0)

    def test_cancel_api_marks_active_job_cancelled(self):
        job = self.make_job()
        result = cancel_import_job(job)
        job.refresh_from_db()
        self.assertEqual((result.status_code, job.status), (200, JobStatus.cancelled))
        self.assertIsNotNone(job.completed_at)

    def test_cancel_api_refuses_a_finished_job(self):
        job = self.make_job()
        UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.completed)
        result = cancel_import_job(job)
        self.assertEqual(
            (result.status_code, result.payload["code"]), (400, "import_job_not_active")
        )

    def test_soft_time_limit_is_reraised_and_fails_the_job(self):
        make_anime(1, anilist_id=101)

        def stop(page):
            raise SoftTimeLimitExceeded

        fetcher = FakeFetcher([anilist_row(101), anilist_row(5)], on_page=stop)
        job = self.make_job()
        with self.assertRaises(SoftTimeLimitExceeded):
            AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.failed)
        self.assertTrue(job.failure_reason.startswith("Took too long; "))
        self.assertIn("of 2 processed. Run it again to continue.", job.failure_reason)

    def test_soft_time_limit_while_storing_a_title_is_reraised(self):
        # Storing a fetched title (cast, images) is the slowest step (council M3).
        fetcher = FakeFetcher([anilist_row(77)], media=[media_item(77)])
        job = self.make_job()
        with (
            patch.object(base_module, "save_media", side_effect=SoftTimeLimitExceeded),
            self.assertRaises(SoftTimeLimitExceeded),
        ):
            AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.failed)
        self.assertTrue(job.failure_reason.startswith("Took too long; "))

    def test_database_error_while_storing_a_title_is_not_marked_invalid(self):
        fetcher = FakeFetcher([anilist_row(77)], media=[media_item(77)])
        job = self.make_job()
        with (
            patch.object(base_module, "save_media", side_effect=OperationalError("db blip")),
            self.assertRaises(OperationalError),
        ):
            AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()
        self.assertEqual((job.status, job.unmatched), (JobStatus.processing, []))

    def test_database_error_leaves_the_job_for_the_task_retry(self):
        fetcher = FakeFetcher()
        job = self.make_job()
        with (
            patch.object(fetcher, "fetch_list_collection", side_effect=OperationalError("down")),
            self.assertRaises(OperationalError),
        ):
            AniListImporter(job, "remote-name", fetcher=fetcher).run()
        job.refresh_from_db()
        self.assertEqual((job.status, job.failure_reason), (JobStatus.processing, ""))

    def test_private_and_missing_lists_fail_with_a_clear_reason(self):
        for message, code in (("Private User", "private"), ("User not found", "not_found")):
            fetcher, _ = graphql_transport(
                lambda q, v, m=message: httpx.Response(404, json={"errors": [{"message": m}]})
            )
            job, result = self.run_anilist(fetcher)
            self.assertEqual((job.status, result["outcome"]), (JobStatus.failed, "failed"))
            self.assertEqual(job.failure_reason, USER_MESSAGES[code])

    def test_unexpected_error_fails_job_but_keeps_xml_payload_for_requeue(self):
        make_anime(1, mal_id=55)
        payload = {"entries": [ImportedEntry(status=Status.watching, mal_id=55).to_payload()]}
        job = self.make_job(source=UserImportJob.ImportSource.myanimelist_xml, payload=payload)
        with (
            patch.object(BaseImporter, "resolve", side_effect=RuntimeError("boom")),
            self.assertRaises(RuntimeError),
        ):
            ImportService.create_importer(job).run()
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.failed)
        self.assertTrue(job.failure_reason)
        self.assertEqual(job.payload, payload)

        # Requeue with only the job (admin retry): the stored entries are used.
        UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.pending)
        job.refresh_from_db()
        ImportService.create_importer(job).run()
        job.refresh_from_db()
        self.assertEqual((job.status, job.imported_entries), (JobStatus.completed, 1))
        self.assertIsNone(job.payload)  # cleared once completed


class PostImportRefreshTests(ImportTestMixin, TestCase):
    patch_refresh = False

    def test_post_import_refresh_runs_once(self):
        anime = make_anime(1, anilist_id=101)
        job = self.make_job()
        with (
            patch("apps.users.services.cache.invalidate_user_caches") as user_caches,
            patch("apps.users.services.list_service.invalidate_lists_summary") as summary,
            patch(
                "apps.animes.services.user_list_side_effects.invalidate_site_status_counts"
            ) as site_counts,
            patch(
                "apps.animes.services.user_list_side_effects.schedule_recommendations_debounced"
            ) as recommendations,
        ):
            AniListImporter(job, "remote-name", fetcher=FakeFetcher([anilist_row(101)])).run()
        user_caches.assert_called_once_with(self.user.id, self.user.username)
        summary.assert_called_once_with(self.user.id)
        site_counts.assert_called_once_with({anime.id})
        recommendations.assert_called_once()

    def test_nothing_written_means_no_refresh(self):
        with patch("apps.users.services.list_service.invalidate_lists_summary") as summary:
            self.run_anilist(FakeFetcher([]))
        summary.assert_not_called()


class XMLImportTests(ImportTestMixin, TestCase):
    XML = (
        b"<myanimelist><anime><series_animedb_id>55</series_animedb_id>"
        b"<series_title><![CDATA[Fifty]]></series_title><my_watched_episodes>3"
        b"</my_watched_episodes><my_start_date>2021-04-02</my_start_date>"
        b"<my_finish_date>0000-00-00</my_finish_date><my_score>8</my_score>"
        b"<my_status>Watching</my_status><my_comments><![CDATA[note]]></my_comments>"
        b"<my_times_watched>2</my_times_watched><my_rewatching>0</my_rewatching>"
        b"</anime></myanimelist>"
    )

    def test_parse_maps_dates_rewatches_and_comments(self):
        (entry,) = parse_mal_xml(self.XML)
        self.assertEqual((entry.mal_id, entry.progress, entry.score), (55, 3, 8))
        self.assertEqual((entry.started, entry.finished), (date(2021, 4, 2), None))
        self.assertEqual((entry.notes, entry.repeat, entry.is_rewatching), ("note", 2, False))

    def test_gzip_is_decompressed(self):
        self.assertEqual(read_upload(gzip.compress(self.XML)), self.XML)

    def test_gzip_bomb_is_rejected(self):
        bomb = gzip.compress(b"a" * (MAX_XML_DECOMPRESSED_BYTES + 1024))
        with self.assertRaises(XMLImportError) as ctx:
            read_upload(bomb)
        self.assertEqual(ctx.exception.code, "xml_file_too_large")

    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    def test_job_stores_entries_and_queues_only_the_job_id(self, apply_async):
        with self.captureOnCommitCallbacks(execute=True):
            result = create_mal_xml_import_job(self.user, "list.xml", parse_mal_xml(self.XML))
        job = UserImportJob.objects.get(pk=result.payload["job_id"])
        self.assertEqual(len((job.payload or {})["entries"]), 1)
        self.assertEqual(apply_async.call_args.kwargs["kwargs"], {"job_id": job.pk})


# --------------------------------------------------------------------------- MAL API


class MyAnimeListAPIImporterTests(ImportTestMixin, TestCase):
    def client_for(self, handler):
        return httpx.Client(transport=httpx.MockTransport(handler))

    @patch("apps.users.services.import_service.mal_api.time.sleep")
    def test_requests_all_list_fields_and_maps_them(self, _sleep):
        anime = make_anime(1, mal_id=21)

        def handler(request):
            self.assertIn("comments", request.url.params["fields"])
            self.assertIn("num_times_rewatched", request.url.params["fields"])
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "node": {"id": 21, "title": "One"},
                            "list_status": {
                                "status": "completed",
                                "score": 9,
                                "num_episodes_watched": 12,
                                "start_date": "2020-01-01",
                                "finish_date": "2020-02-01",
                                "num_times_rewatched": 1,
                                "is_rewatching": False,
                                "comments": "loved it",
                                "updated_at": "2024-01-01T00:00:00+00:00",
                            },
                        }
                    ],
                    "paging": {},
                },
            )

        job = self.make_job(source=UserImportJob.ImportSource.myanimelist_api)
        MyAnimeListAPIImporter(
            job, "someone", client_id="cid", http_client=self.client_for(handler)
        ).run()
        entry = UserAnimeList.objects.get(user=self.user, anime=anime)
        self.assertEqual((entry.status, entry.score, entry.notes), ("Completed", 9, "loved it"))
        self.assertEqual(
            (entry.started_at, entry.finished_at, entry.total_rewatches),
            (date(2020, 1, 1), date(2020, 2, 1), 1),
        )

    @patch("apps.users.services.import_service.mal_api.time.sleep")
    def test_cancel_stops_the_list_download_between_pages(self, _sleep):
        job = self.make_job(source=UserImportJob.ImportSource.myanimelist_api)
        offsets = []

        def handler(request):
            offsets.append(int(request.url.params["offset"]))
            UserImportJob.objects.filter(pk=job.pk).update(status=JobStatus.cancelled)
            return httpx.Response(200, json={"data": [], "paging": {"next": "more"}})

        result = MyAnimeListAPIImporter(
            job, "someone", client_id="cid", http_client=self.client_for(handler)
        ).run()

        self.assertEqual((result["outcome"], offsets), ("cancelled", [0]))

    @patch("apps.users.services.import_service.mal_api.time.sleep")
    def test_rate_limit_retry_budget_fails_the_job(self, sleep):
        job = self.make_job(source=UserImportJob.ImportSource.myanimelist_api)
        importer = MyAnimeListAPIImporter(
            job,
            "someone",
            client_id="cid",
            http_client=self.client_for(
                lambda r: httpx.Response(429, headers={"Retry-After": "0"})
            ),
        )
        result = importer.run()
        job.refresh_from_db()
        self.assertEqual((result["outcome"], job.status), ("failed", JobStatus.failed))
        self.assertIn("busy", job.failure_reason)
        self.assertEqual(sleep.call_count, MyAnimeListAPIImporter.MAX_PAGE_RETRIES - 1)


# --------------------------------------------------------------------------- jobs, tasks


class ImportJobServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="import-job-user", email="import-job@example.com", password="password123"
        )

    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_create_mal_import_job_queues_task_on_commit(self, mock_on_commit, mock_delay):
        result = create_mal_import_job(self.user, "sample-user")

        self.assertEqual(mock_delay.call_count, 0)
        mock_on_commit.call_args.args[0]()
        self.assertEqual(result.status_code, 202)
        self.assertEqual(mock_delay.call_count, 1)

    def test_create_mal_import_job_rejects_active_import(self):
        UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier="existing-user",
            status=JobStatus.pending,
        )
        result = create_mal_import_job(self.user, "sample-user")
        self.assertEqual(
            (result.status_code, result.payload["code"]), (429, "import_already_running")
        )

    @override_settings(MAX_IMPORT_JOBS_PER_DAY=1)
    def test_create_mal_import_job_rejects_daily_quota(self):
        UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.myanimelist_api,
            source_identifier="completed-user",
            status=JobStatus.completed,
        )
        result = create_mal_import_job(self.user, "sample-user")
        self.assertEqual(
            (result.status_code, result.payload["code"]), (429, "daily_import_limit_reached")
        )

    @patch(
        "apps.users.services.import_job_service.process_import_job.apply_async",
        side_effect=RuntimeError("broker down"),
    )
    def test_enqueue_failure_marks_job_failed_with_a_reason(self, _mock_delay):
        with self.captureOnCommitCallbacks(execute=True):
            result = create_mal_import_job(self.user, "sample-user")
        job = UserImportJob.objects.get(id=result.payload["job_id"])
        self.assertEqual(job.status, JobStatus.failed)
        self.assertIn("Failed to queue import job", job.errors)
        self.assertTrue(job.failure_reason)

    def test_prerun_signal_stores_redacted_kwargs(self):
        from ...core.celery_signals import on_task_prerun
        from ...core.models import CeleryTaskResult

        on_task_prerun(
            task_id="redaction-test",
            task=process_import_job,
            args=(),
            kwargs={"job_id": 1, "access_token": "secret-bearer-token", "xml_content": "<x/>"},
        )
        stored = CeleryTaskResult.objects.get(task_id="redaction-test").task_kwargs
        self.assertEqual(
            stored, {"job_id": 1, "access_token": "[redacted]", "xml_content": "[4 characters]"}
        )

    def test_importer_for_requeued_job_uses_stored_username(self):
        job = UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, source_identifier="stored"
        )
        importer = ImportService.create_importer(job)
        assert isinstance(importer, AniListImporter)
        self.assertEqual(importer.username, "stored")

    def test_old_queued_token_kwarg_is_dropped(self):
        job = UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, source_identifier="stored"
        )
        importer = ImportService.create_importer(job, access_token="leftover")
        self.assertFalse(hasattr(importer, "access_token"))


class ImportJobMaintenanceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="m", email="m@example.com", password="pw")

    def job(self, **fields):
        return UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, **fields
        )

    def test_stalled_processing_jobs_are_failed_after_two_hours(self):
        now = timezone.now()
        dead = self.job(status=JobStatus.processing, heartbeat_at=now - timedelta(hours=3))
        alive = self.job(status=JobStatus.processing, heartbeat_at=now - timedelta(hours=1))
        never_beat = self.job(status=JobStatus.processing, started_at=now - timedelta(hours=3))

        self.assertEqual(UserTaskService.fail_stalled_import_jobs(), 2)
        for job, expected in ((dead, "failed"), (alive, "processing"), (never_beat, "failed")):
            job.refresh_from_db()
            self.assertEqual(job.status, expected)
        dead.refresh_from_db()
        self.assertIn("worker stopped", dead.failure_reason)

    def test_cleanup_deletes_old_cancelled_jobs_and_keeps_recent_ones(self):
        old = self.job(status=JobStatus.cancelled)
        recent = self.job(status=JobStatus.cancelled)
        UserImportJob.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=31)
        )
        self.assertEqual(UserTaskService.cleanup_old_import_jobs(days=30), 1)
        self.assertFalse(UserImportJob.objects.filter(pk=old.pk).exists())
        self.assertTrue(UserImportJob.objects.filter(pk=recent.pk).exists())

    def test_mark_failed_never_overwrites_a_cancel(self):
        job = self.job(status=JobStatus.cancelled)
        UserTaskService.mark_import_job_failed(job.pk, "late error")
        job.refresh_from_db()
        self.assertEqual((job.status, job.failure_reason), (JobStatus.cancelled, ""))

    def test_mark_failed_sets_a_reason_on_an_active_job(self):
        job = self.job(status=JobStatus.processing)
        UserTaskService.mark_import_job_failed(job.pk, "late error")
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.failed)
        self.assertIn("late error", job.errors)
        self.assertTrue(job.failure_reason)

    def test_process_skips_cancelled_job(self):
        job = self.job(status=JobStatus.cancelled)
        result = UserTaskService.process_import_job(job_id=job.pk)
        self.assertEqual(result["reason"], "job_cancelled")

    def test_import_task_uses_the_long_time_limit(self):
        self.assertEqual(
            (process_import_job.time_limit, process_import_job.soft_time_limit), (3600, 3300)
        )


class ImportTaskWrapperTests(TestCase):
    @patch("apps.users.tasks.UserTaskService.mark_import_job_failed")
    @patch(
        "apps.users.tasks.UserTaskService.process_import_job",
        side_effect=OperationalError("db down"),
    )
    @patch("apps.users.tasks._can_retry", return_value=True)
    @patch.object(process_import_job, "retry", side_effect=Retry())
    def test_process_import_job_does_not_mark_failed_before_retry(
        self, _mock_retry, _mock_can_retry, _mock_process, mock_mark_failed
    ):
        with self.assertRaises(Retry):
            process_import_job.run(job_id=123)
        mock_mark_failed.assert_not_called()

    @patch("apps.users.tasks.UserTaskService.mark_import_job_failed")
    @patch(
        "apps.users.tasks.UserTaskService.process_import_job",
        side_effect=OperationalError("db down"),
    )
    @patch("apps.users.tasks._can_retry", return_value=False)
    def test_process_import_job_marks_failed_after_retry_budget_exhausted(
        self, _mock_can_retry, _mock_process, mock_mark_failed
    ):
        with self.assertRaises(OperationalError):
            process_import_job.run(job_id=123)
        mock_mark_failed.assert_called_once()

    @patch("apps.users.tasks.UserTaskService.mark_import_job_failed")
    @patch("apps.users.tasks.UserTaskService.process_import_job", side_effect=SoftTimeLimitExceeded)
    def test_soft_time_limit_is_not_retried_or_refailed(self, _mock_process, mock_mark_failed):
        with self.assertRaises(SoftTimeLimitExceeded):
            process_import_job.run(job_id=123)
        mock_mark_failed.assert_not_called()


# --------------------------------------------------------------------------- API


class ImportExportApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="api-import-user", email="api-import@example.com", password="password123"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _set_email_verified(self, verified=True):
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": verified})
        self.user.refresh_from_db()

    def test_mal_import_requires_verified_email(self):
        self._set_email_verified(False)
        response = self.client.post(reverse("import_mal"), {"username": "u"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "email_verification_required")

    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_verified_user_can_start_mal_import(self, mock_on_commit):
        self._set_email_verified(True)
        response = self.client.post(reverse("import_mal"), {"username": "u"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(mock_on_commit.call_count, 1)

    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    def test_anilist_access_token_never_reaches_the_worker(self, apply_async):
        self._set_email_verified(True)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                reverse("import_anilist"),
                {"username": "someone", "access_token": "secret-bearer-token"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        call = apply_async.call_args.kwargs
        self.assertEqual(call["kwargs"], {"job_id": response.data["job_id"]})
        self.assertNotIn("secret-bearer-token", call["kwargsrepr"])
        self.assertNotIn("secret-bearer-token", json.dumps(call, default=str))

    @override_settings(MAX_IMPORT_XML_ENTRIES=1)
    @patch("apps.users.services.import_job_service.transaction.on_commit")
    def test_mal_xml_import_rejects_too_many_entries(self, mock_on_commit):
        self._set_email_verified(True)
        upload = SimpleUploadedFile(
            "list.xml", b"<myanimelist><anime /><anime /></myanimelist>", "application/xml"
        )
        response = self.client.post(reverse("import_mal_xml"), {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "xml_entry_limit_exceeded")
        mock_on_commit.assert_not_called()

    @patch("apps.users.services.import_job_service.process_import_job.apply_async")
    def test_xml_and_gzipped_xml_uploads_are_accepted(self, apply_async):
        self._set_email_verified(True)
        uploads = [
            ("list.xml", XMLImportTests.XML),
            ("list.xml.gz", gzip.compress(XMLImportTests.XML)),
        ]
        for name, content in uploads:
            UserImportJob.objects.all().delete()
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    reverse("import_mal_xml"),
                    {"file": SimpleUploadedFile(name, content)},
                    format="multipart",
                )
            self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, (name, response.data))
            job = UserImportJob.objects.get(pk=response.data["job_id"])
            self.assertEqual((job.payload or {})["entries"][0]["mal_id"], 55)
        self.assertNotIn("xml_content", apply_async.call_args.kwargs["kwargs"])

    def test_gzip_bomb_upload_is_rejected(self):
        self._set_email_verified(True)
        bomb = gzip.compress(b"<" * (MAX_XML_DECOMPRESSED_BYTES + 1024))
        response = self.client.post(
            reverse("import_mal_xml"),
            {"file": SimpleUploadedFile("bomb.xml.gz", bomb)},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "xml_file_too_large")
        self.assertFalse(UserImportJob.objects.exists())

    def test_other_file_types_are_rejected(self):
        self._set_email_verified(True)
        response = self.client.post(
            reverse("import_mal_xml"),
            {"file": SimpleUploadedFile("list.json", b"{}")},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "invalid_xml_file")

    def test_job_payload_exposes_new_fields(self):
        job = UserImportJob.objects.create(
            user=self.user,
            source=UserImportJob.ImportSource.anilist,
            status=JobStatus.cancelled,
            failure_reason="why",
            unmatched=[{"title": "t", "mal_id": None, "anilist_id": 1, "reason": "not_found"}],
        )
        response = self.client.get(reverse("import_job_status", args=[job.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for field in ("mode", "failure_reason", "unmatched", "heartbeat_at"):
            self.assertIn(field, response.data)
        self.assertEqual(response.data["status_display"], "Cancelled")

    def test_cancel_endpoint(self):
        self._set_email_verified(True)
        job = UserImportJob.objects.create(
            user=self.user, source=UserImportJob.ImportSource.anilist, status=JobStatus.processing
        )
        response = self.client.post(reverse("import_job_cancel", args=[job.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.cancelled)

        other = User.objects.create_user(username="other", email="o@example.com", password="pw")
        foreign = UserImportJob.objects.create(
            user=other, source=UserImportJob.ImportSource.anilist, status=JobStatus.processing
        )
        response = self.client.post(reverse("import_job_cancel", args=[foreign.pk]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
