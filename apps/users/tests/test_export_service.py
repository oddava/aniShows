"""Data export (spec 3 P0-6, P1-6): JSON sections, preview shape, MAL XML escaping and round trip."""

from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from unittest.mock import patch

from defusedxml import ElementTree
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from ...animes.models import (
    Character,
    EpisodeRating,
    Staff,
    UserFavoriteCharacter,
    UserFavoriteStaff,
)
from ..models import UserAnimeList, UserFollow, UserImportJob, UserProfile
from ..services.export_service import ExportService, ListCSVExporter, MALXMLExporter
from ..services.import_service import base as base_module
from ..services.import_service.base import BaseImporter
from ..services.import_service.mal_xml import MyAnimeListXMLImporter, parse_mal_xml
from .test_import_service import make_anime

User = get_user_model()
Status = UserAnimeList.UserAnimeStatus


if TYPE_CHECKING:
    _MixinBase = TestCase
else:
    _MixinBase = object


class ExportFixtureMixin(_MixinBase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="exporter", email="exporter@example.com", password="pw"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"email_verified": True})
        self.user.refresh_from_db()
        self.tricky = make_anime(1, mal_id=501, title="Ends ]]> here & <there>")
        self.plain = make_anime(2, mal_id=502, title="Plain")
        self.no_mal = make_anime(3, anilist_id=903, title="AniList only")
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.tricky,
            status=Status.completed,
            score=9,
            episodes_watched=12,
            started_at=date(2022, 1, 2),
            finished_at=date(2022, 3, 4),
            total_rewatches=2,
            notes="loved ]]> it & more",
        )
        UserAnimeList.objects.create(
            user=self.user,
            anime=self.plain,
            status=Status.watching,
            episodes_watched=3,
            is_rewatching=True,
            total_rewatches=1,
        )
        UserAnimeList.objects.create(user=self.user, anime=self.no_mal, status=Status.plan_to_watch)


class JsonExportTests(ExportFixtureMixin, TestCase):
    def test_json_export_has_every_section_and_version_2(self):
        friend = User.objects.create_user(username="friend", email="f@example.com", password="pw")
        UserFollow.objects.create(follower=self.user, following=friend)
        EpisodeRating.objects.create(
            user=self.user, anime=self.plain, episode_number=2, rating=Decimal("4.5")
        )
        UserFavoriteCharacter.objects.create(
            user=self.user, character=Character.objects.create(name="Hero", anilist_id=1)
        )
        UserFavoriteStaff.objects.create(
            user=self.user, staff=Staff.objects.create(name="Director", anilist_id=2)
        )

        data = ExportService.export_user_data_object(self.user)

        self.assertEqual(data["export_metadata"]["version"], "2")
        self.assertIn("+00:00", data["export_metadata"]["exported_at"])  # aware timestamp
        for section in (
            "profile",
            "anime_list",
            "episode_ratings",
            "favorites",
            "character_favorites",
            "staff_favorites",
            "following",
            "reviews",
        ):
            self.assertIn(section, data)
        self.assertEqual(len(data["anime_list"]), 3)
        self.assertEqual(data["following"], ["friend"])
        self.assertEqual(data["episode_ratings"][0]["rating"], "4.5")
        self.assertEqual(data["character_favorites"][0]["character"]["name"], "Hero")
        self.assertEqual(data["staff_favorites"][0]["staff"]["anilist_id"], 2)


class ExportApiTests(ExportFixtureMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.user)

    def test_preview_returns_an_object_not_a_string(self):
        response = self.client.get(
            reverse("export_user_data"), {"type": "json", "download": "false"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data["data"], dict)
        self.assertEqual(response.data["data"]["export_metadata"]["username"], "exporter")

    def test_download_is_an_attachment(self):
        response = self.client.get(reverse("export_user_data"), {"type": "json"})
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertIn("attachment;", response["Content-Disposition"])

    def test_xml_download_reports_skipped_entries(self):
        response = self.client.get(reverse("export_user_data"), {"type": "xml"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Export-Skipped"], "1")
        self.assertIn(b"1 entries without a MyAnimeList id", response.content)

    def test_csv_download_is_a_utf8_attachment(self):
        response = self.client.get(reverse("export_user_data"), {"type": "csv"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn('.csv"', response["Content-Disposition"])
        self.assertTrue(response.content.startswith("\ufeff".encode()))

    def test_invalid_type_is_rejected(self):
        response = self.client.get(reverse("export_user_data"), {"type": "pdf"})
        self.assertEqual(
            (response.status_code, response.data["code"]), (400, "invalid_export_type")
        )

    def test_export_requires_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(reverse("export_user_data")).status_code, (401, 403))


class CsvExportTests(ExportFixtureMixin, TestCase):
    def rows(self):
        content = ListCSVExporter(self.user).export()
        self.assertTrue(content.startswith("\ufeff"))
        return list(csv.DictReader(io.StringIO(content.removeprefix("\ufeff"))))

    def test_every_entry_with_readable_status_and_ids(self):
        rows = self.rows()
        self.assertEqual(
            [row["title"] for row in rows], ["Ends ]]> here & <there>", "Plain", "AniList only"]
        )
        first = rows[0]
        self.assertEqual(first["status"], "Completed")
        self.assertEqual(first["score"], "9")
        self.assertEqual(first["started_at"], "2022-01-02")
        self.assertEqual(first["times_rewatched"], "2")
        self.assertEqual(first["notes"], "loved ]]> it & more")
        self.assertEqual(first["mal_id"], "501")
        self.assertEqual(rows[1]["rewatching"], "yes")
        self.assertEqual(rows[2]["mal_id"], "")
        self.assertEqual(rows[2]["anilist_id"], "903")

    def test_formula_like_text_is_neutralised(self):
        UserAnimeList.objects.filter(anime=self.plain).update(notes='=HYPERLINK("x")')
        self.assertEqual(self.rows()[1]["notes"], '\'=HYPERLINK("x")')


class XmlExportTests(ExportFixtureMixin, TestCase):
    def export_root(self):
        exporter = MALXMLExporter(self.user)
        content = exporter.export()
        return ElementTree.fromstring(content.encode()), exporter

    def test_titles_and_comments_with_cdata_terminators_parse(self):
        root, exporter = self.export_root()
        self.assertEqual(exporter.skipped, 1)
        animes = {el.findtext("series_animedb_id"): el for el in root.findall("anime")}
        self.assertEqual(set(animes), {"501", "502"})
        tricky = animes["501"]
        self.assertEqual(tricky.findtext("series_title"), "Ends ]]> here & <there>")
        self.assertEqual(tricky.findtext("my_comments"), "loved ]]> it & more")
        self.assertEqual(root.findtext("myinfo/user_total_anime"), "2")

    def test_real_dates_rewatches_and_rewatching_flag(self):
        root, _ = self.export_root()
        animes = {el.findtext("series_animedb_id"): el for el in root.findall("anime")}
        tricky, plain = animes["501"], animes["502"]
        self.assertEqual(tricky.findtext("my_start_date"), "2022-01-02")
        self.assertEqual(tricky.findtext("my_finish_date"), "2022-03-04")
        self.assertEqual(tricky.findtext("my_times_watched"), "2")
        self.assertEqual(plain.findtext("my_finish_date"), "0000-00-00")
        self.assertEqual(plain.findtext("my_rewatching"), "1")

    def test_export_then_reimport_keeps_dates_rewatches_and_notes(self):
        content = MALXMLExporter(self.user).export()
        entries = parse_mal_xml(content)
        fresh = User.objects.create_user(username="fresh", email="fresh@example.com", password="pw")
        job = UserImportJob.objects.create(
            user=fresh,
            source=UserImportJob.ImportSource.myanimelist_xml,
            status=UserImportJob.ImportStatus.processing,
            payload={"entries": [entry.to_payload() for entry in entries]},
        )
        with (
            patch.object(BaseImporter, "refresh_derived_data"),
            patch.object(base_module, "save_media"),
        ):
            result = MyAnimeListXMLImporter(job).run()

        self.assertEqual((result["outcome"], result["imported"]), ("completed", 2))
        tricky = UserAnimeList.objects.get(user=fresh, anime=self.tricky)
        self.assertEqual(
            (tricky.status, tricky.score, tricky.episodes_watched),
            (Status.completed, 9, 12),
        )
        self.assertEqual(
            (tricky.started_at, tricky.finished_at), (date(2022, 1, 2), date(2022, 3, 4))
        )
        self.assertEqual((tricky.total_rewatches, tricky.notes), (2, "loved ]]> it & more"))
        plain = UserAnimeList.objects.get(user=fresh, anime=self.plain)
        self.assertEqual(
            (plain.status, plain.episodes_watched, plain.is_rewatching, plain.total_rewatches),
            (Status.watching, 3, True, 1),
        )
