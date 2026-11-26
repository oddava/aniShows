"""Global search, member list imports and the dashboard's attention block."""

from unittest.mock import patch

import pytest
from django.test import TestCase

from ...animes.models import Anime, Review, ReviewReport
from ...core.models import CeleryTaskResult
from ...forums.models import Category, Thread
from ...users.models import UserImportJob
from .helpers import bearer_client, make_user


class SearchTests(TestCase):
    def setUp(self):
        patcher = patch("apps.animes.signals.enrich_metadata.delay", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client_ = bearer_client(make_user("mod", role="staff"))
        self.member = make_user("frieren_fan")
        self.anime = Anime.objects.create(
            title="Frieren",
            slug="frieren",
            synopsis="x",
            status="Airing",
            anime_type="TV",
            anilist_id=154587,
        )
        Review.objects.create(user=self.member, anime=self.anime, rating=9, text="Frieren is calm")
        category = Category.objects.create(name="General", slug="general")
        Thread.objects.create(
            category=category, author=self.member, title="Frieren talk", content="x"
        )

    def test_short_query_is_refused(self):
        self.assertEqual(self.client_.get("/api/v1/admin/search/?q=f").status_code, 400)

    def test_finds_every_kind(self):
        response = self.client_.get("/api/v1/admin/search/?q=frieren")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["users"][0]["username"], "frieren_fan")
        self.assertEqual(response.data["anime"][0]["slug"], "frieren")
        self.assertEqual(response.data["reviews"][0]["username"], "frieren_fan")
        self.assertEqual(response.data["threads"][0]["category"], "General")

    def test_digits_match_ids(self):
        response = self.client_.get("/api/v1/admin/search/?q=154587")
        self.assertEqual([row["id"] for row in response.data["anime"]], [self.anime.id])

    def test_regular_users_are_refused(self):
        self.assertEqual(
            bearer_client(make_user("nobody")).get("/api/v1/admin/search/?q=fr").status_code, 403
        )


class UserImportTests(TestCase):
    def setUp(self):
        self.client_ = bearer_client(make_user("mod", role="staff"))
        self.member = make_user("importer")
        self.job = UserImportJob.objects.create(
            user=self.member,
            source="anilist",
            status="failed",
            failure_reason="Private list",
            errors=[{"line": n} for n in range(60)],
        )
        UserImportJob.objects.create(user=self.member, source="mal_xml", status="completed")

    def test_list_filters(self):
        response = self.client_.get("/api/v1/admin/user-imports/?status=failed")
        self.assertEqual(response.data["count"], 1)
        row = response.data["results"][0]
        self.assertEqual(row["user"]["username"], "importer")
        self.assertNotIn("errors", row)

    def test_detail_caps_errors(self):
        response = self.client_.get(f"/api/v1/admin/user-imports/{self.job.id}/")
        self.assertEqual(len(response.data["errors"]), 50)
        self.assertEqual(response.data["failure_reason"], "Private list")


class DashboardAttentionTests(TestCase):
    def test_attention_counts(self):
        root = make_user("root", role="superuser")
        member = make_user("member")
        suspended = make_user("suspended")
        suspended.is_active = False
        suspended.save(update_fields=["is_active"])
        with patch("apps.animes.signals.enrich_metadata.delay", return_value=None):
            anime = Anime.objects.create(
                title="A", slug="a", synopsis="x", status="Airing", anime_type="TV"
            )
        review = Review.objects.create(user=member, anime=anime, rating=5, text="t")
        ReviewReport.objects.create(review=review, reporter=root, reason="spam")
        CeleryTaskResult.objects.create(task_id="t1", task_name="x.y", status="FAILURE")
        UserImportJob.objects.create(user=member, source="anilist", status="failed")

        response = bearer_client(root).get("/api/v1/admin/dashboard/?refresh=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["attention"],
            {
                "open_reports": 1,
                "open_reviews": 1,
                "failed_tasks_24h": 1,
                "quarantined_sync": 0,
                "failed_user_imports_24h": 1,
                "suspended_users": 1,
            },
        )
        self.assertIn("active_7d", response.data["statistics"]["users"])
        self.assertEqual(response.data["charts"]["reviews_30d"][0]["count"], 1)
        self.assertIn("avatar", response.data["recent_users"][0])


ROWS = (3, 15)


@pytest.mark.django_db
@pytest.mark.parametrize("rows", ROWS)
@pytest.mark.parametrize(
    ("url", "budget"),
    [
        ("/api/v1/admin/forum-threads/", 3),
        ("/api/v1/admin/forum-posts/", 3),
        ("/api/v1/admin/forum-tags/", 3),
        ("/api/v1/admin/user-imports/", 3),
        ("/api/v1/admin/announcements/", 3),
        ("/api/v1/admin/search/?q=budget", 5),
    ],
)
def test_new_lists_stay_within_budget(url, budget, rows, django_assert_max_num_queries):
    from ...core.models import Announcement
    from ...forums.models import Post, Tag

    root = make_user(f"budget-root-{rows}", role="superuser")
    category = Category.objects.create(name=f"C{rows}", slug=f"c{rows}")
    for index in range(rows):
        user = make_user(f"budget-u{index}-{rows}")
        thread = Thread.objects.create(
            category=category, author=user, title=f"budget {index}", content="x"
        )
        Post.objects.create(thread=thread, author=user, content="y")
        thread.tags.add(Tag.objects.create(name=f"t{index}", slug=f"t{rows}-{index}"))
        UserImportJob.objects.create(user=user, source="anilist", status="failed")
        Announcement.objects.create(title=f"a{index}", created_by=root)
    client = bearer_client(root)
    # JWT user lookup + the once-a-minute last_activity stamp.
    with django_assert_max_num_queries(budget + 2):
        response = client.get(url)
    assert response.status_code == 200, response.data
