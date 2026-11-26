"""Anime admin: filters, detail, SEO edit, refresh and image re-download; review spoiler flip."""

from unittest.mock import patch

from django.test import TestCase

from ...animes.models import Anime, OfflineAnimeSyncState, Review, ReviewReport
from ...core.models import AuditLog, CeleryTaskResult
from .helpers import bearer_client, make_user


class AnimeToolsTests(TestCase):
    def setUp(self):
        for target in (
            "apps.animes.signals.enrich_metadata.delay",
            "celery.app.base.Celery.send_task",
        ):
            patcher = patch(target, return_value=None)
            self.addCleanup(patcher.stop)
            setattr(self, target.rsplit(".", 1)[-1], patcher.start())
        self.staff_client = bearer_client(make_user("mod", role="staff"))
        self.root_client = bearer_client(make_user("root", role="superuser"))
        self.anime = Anime.objects.create(
            title="Frieren",
            slug="frieren",
            synopsis="x",
            status="Airing",
            anime_type="TV",
            anilist_id=154587,
            cover_image_external_url="https://img.example/cover.jpg",
            season="FALL",
            season_year=2023,
        )
        self.bare = Anime.objects.create(
            title="Bare", slug="bare", synopsis="", status="Airing", anime_type="TV"
        )

    def _titles(self, query):
        response = self.staff_client.get(f"/api/v1/admin/anime/?{query}")
        self.assertEqual(response.status_code, 200, response.data)
        return sorted(row["title"] for row in response.data["results"])

    def test_filters(self):
        self.assertEqual(self._titles("missing=cover"), ["Bare"])
        self.assertEqual(self._titles("missing=synopsis"), ["Bare"])
        self.assertEqual(self._titles("missing=anilist_id"), ["Bare"])
        self.assertEqual(self._titles("missing=studio"), ["Bare", "Frieren"])
        self.assertEqual(self._titles("season=FALL&season_year=2023"), ["Frieren"])
        self.assertEqual(self._titles("anilist_id=154587"), ["Frieren"])
        self.assertEqual(self._titles("is_adult=false"), ["Bare", "Frieren"])

    def test_list_rows_have_a_poster(self):
        response = self.staff_client.get("/api/v1/admin/anime/?search=Frieren")
        self.assertEqual(response.data["results"][0]["poster"], "https://img.example/cover.jpg")

    def test_detail_has_identity_and_sync_state(self):
        OfflineAnimeSyncState.objects.create(anime=self.anime, quarantined=True)
        response = self.staff_client.get(f"/api/v1/admin/anime/{self.anime.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["anilist_id"], 154587)
        self.assertEqual(response.data["list_entries_count"], 0)
        self.assertTrue(response.data["sync_state"]["quarantined"])
        self.assertIsNone(
            self.staff_client.get(f"/api/v1/admin/anime/{self.bare.id}/").data["sync_state"]
        )

    def test_patch_only_changes_meta_description(self):
        url = f"/api/v1/admin/anime/{self.anime.id}/"
        self.assertEqual(
            self.staff_client.patch(url, {"meta_description": "x"}, format="json").status_code, 403
        )
        response = self.root_client.patch(
            url, {"meta_description": "Elf mage", "title": "Hacked"}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.anime.refresh_from_db()
        self.assertEqual((self.anime.meta_description, self.anime.title), ("Elf mage", "Frieren"))
        row = AuditLog.objects.get()
        self.assertEqual(row.changes, {"meta_description": {"old": "", "new": "Elf mage"}})
        self.assertEqual(self.root_client.put(url, {}, format="json").status_code, 405)

    def test_refresh_queues_a_tracked_task(self):
        response = self.root_client.post(f"/api/v1/admin/anime/{self.anime.id}/refresh/")

        self.assertEqual(response.status_code, 202, response.data)
        job = CeleryTaskResult.objects.get(task_id=response.data["task_id"])
        self.assertEqual(job.task_kwargs, {"anime_id": self.anime.id, "mode": "single"})
        self.assertEqual(job.queue, "batch")
        self.assertEqual(AuditLog.objects.get().action, "TRIGGER")
        refused = self.root_client.post(f"/api/v1/admin/anime/{self.bare.id}/refresh/")
        self.assertEqual(refused.status_code, 400)

    def test_refetch_images(self):
        response = self.root_client.post(f"/api/v1/admin/anime/{self.anime.id}/refetch_images/")

        self.assertEqual(response.status_code, 202, response.data)
        job = CeleryTaskResult.objects.get(task_id=response.data["task_id"])
        self.assertTrue(job.task_kwargs["force_replace"])
        self.assertEqual(job.queue, "images")
        refused = self.root_client.post(f"/api/v1/admin/anime/{self.bare.id}/refetch_images/")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(AuditLog.objects.count(), 1)


class ReviewToolsTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.staff_client = bearer_client(make_user("mod", role="staff"))
        self.author = make_user("author")
        self.anime = Anime.objects.create(
            title="Review Me", slug="review-me", synopsis="x", status="Airing", anime_type="TV"
        )
        self.review = Review.objects.create(user=self.author, anime=self.anime, rating=4, text="t")
        ReviewReport.objects.create(review=self.review, reporter=make_user("r1"), reason="spam")

    def test_list_has_open_report_count_and_filters(self):
        response = self.staff_client.get(
            f"/api/v1/admin/reviews/?user={self.author.id}&anime={self.anime.id}"
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["report_count"], 1)
        other = self.staff_client.get(f"/api/v1/admin/reviews/?user={self.author.id + 999}")
        self.assertEqual(other.data["count"], 0)

    def test_toggle_spoiler(self):
        url = f"/api/v1/admin/reviews/{self.review.id}/toggle_spoiler/"
        first = self.staff_client.post(url)
        second = self.staff_client.post(url)

        self.assertEqual((first.data["has_spoilers"], second.data["has_spoilers"]), (True, False))
        self.assertEqual(AuditLog.objects.count(), 2)
        self.assertEqual(
            AuditLog.objects.order_by("id").first().changes,
            {"has_spoilers": {"old": False, "new": True}},
        )
