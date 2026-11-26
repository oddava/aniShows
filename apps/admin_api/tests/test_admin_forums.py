"""Forum administration: categories and tags (superuser), threads and posts (staff)."""

from django.test import TestCase

from ...core.models import AuditLog
from ...forums.models import Category, Post, Tag, Thread
from .helpers import bearer_client, make_user

BASE = "/api/v1/admin/"


class ForumAdminTests(TestCase):
    def setUp(self):
        self.staff = make_user("mod", role="staff")
        self.staff_client = bearer_client(self.staff)
        self.root_client = bearer_client(make_user("root", role="superuser"))
        self.author = make_user("author")
        self.general = Category.objects.create(name="General", slug="general")
        self.news = Category.objects.create(name="News", slug="news")
        self.thread = Thread.objects.create(
            category=self.general, author=self.author, title="Hello", content="First post"
        )
        self.post = Post.objects.create(thread=self.thread, author=self.author, content="Reply")

    def _audit_count(self):
        return AuditLog.objects.count()

    # Categories and tags

    def test_long_and_repeated_names_get_a_valid_unique_slug(self):
        long_name = "Seasonal discussion " + "x" * 120
        first = self.root_client.post(
            f"{BASE}forum-categories/", {"name": long_name}, format="json"
        )
        self.assertEqual(first.status_code, 201, first.data)
        self.assertLessEqual(len(first.data["slug"]), 50)

        second = self.root_client.post(
            f"{BASE}forum-categories/", {"name": long_name}, format="json"
        )
        self.assertEqual(second.status_code, 201, second.data)
        self.assertLessEqual(len(second.data["slug"]), 50)
        self.assertTrue(second.data["slug"].endswith("-2"))

        named_like_general = self.root_client.post(
            f"{BASE}forum-categories/", {"name": "General"}, format="json"
        )
        self.assertEqual(named_like_general.data["slug"], "general-2")

    def test_category_crud_is_superuser_only_and_slugs_itself(self):
        payload = {"name": "Seasonal Talk", "description": "x", "order": 3}
        self.assertEqual(
            self.staff_client.post(f"{BASE}forum-categories/", payload, format="json").status_code,
            403,
        )
        created = self.root_client.post(f"{BASE}forum-categories/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["slug"], "seasonal-talk")

        clash = self.root_client.post(
            f"{BASE}forum-categories/", {"name": "x", "slug": "general"}, format="json"
        )
        self.assertEqual(clash.status_code, 400)

        renamed = self.root_client.patch(
            f"{BASE}forum-categories/{created.data['id']}/", {"name": "Seasons"}, format="json"
        )
        self.assertEqual(renamed.data["slug"], "seasonal-talk")
        self.assertEqual(self._audit_count(), 2)

    def test_category_with_threads_cannot_be_deleted(self):
        response = self.root_client.delete(f"{BASE}forum-categories/{self.general.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self.root_client.delete(f"{BASE}forum-categories/{self.news.id}/").status_code, 204
        )
        self.assertEqual(AuditLog.objects.get().action, "DELETE")

    def test_tags_validate_colour_and_count_threads(self):
        bad = self.root_client.post(
            f"{BASE}forum-tags/", {"name": "Spoilers", "color": "red"}, format="json"
        )
        self.assertEqual(bad.status_code, 400)
        made = self.root_client.post(
            f"{BASE}forum-tags/", {"name": "Spoilers", "color": "#AA00FF"}, format="json"
        )
        self.assertEqual((made.data["slug"], made.data["color"]), ("spoilers", "#aa00ff"))
        self.thread.tags.add(Tag.objects.get(pk=made.data["id"]))
        listed = self.staff_client.get(f"{BASE}forum-tags/")
        self.assertEqual(listed.data["results"][0]["thread_count"], 1)

    # Threads

    def test_thread_list_filters_and_search(self):
        Thread.objects.create(
            category=self.news, author=self.author, title="Other", content="y", is_removed=True
        )
        response = self.staff_client.get(f"{BASE}forum-threads/?category={self.general.id}")
        self.assertEqual([row["title"] for row in response.data["results"]], ["Hello"])
        removed = self.staff_client.get(f"{BASE}forum-threads/?is_removed=true")
        self.assertEqual([row["title"] for row in removed.data["results"]], ["Other"])
        found = self.staff_client.get(f"{BASE}forum-threads/?search=author")
        self.assertEqual(found.data["count"], 2)
        detail = self.staff_client.get(f"{BASE}forum-threads/{self.thread.id}/")
        self.assertEqual(detail.data["content"], "First post")

    def test_pin_is_idempotent_and_audited_once(self):
        url = f"{BASE}forum-threads/{self.thread.id}/pin/"
        self.assertEqual(self.staff_client.post(url, {}, format="json").status_code, 400)
        first = self.staff_client.post(url, {"is_pinned": True}, format="json")
        second = self.staff_client.post(url, {"is_pinned": True}, format="json")
        self.assertTrue(first.data["is_pinned"] and second.data["is_pinned"])
        self.assertEqual(self._audit_count(), 1)

    def test_lock_sets_the_requested_state(self):
        url = f"{BASE}forum-threads/{self.thread.id}/lock/"
        self.assertTrue(
            self.staff_client.post(url, {"is_locked": True}, format="json").data["is_locked"]
        )
        self.assertTrue(
            self.staff_client.post(url, {"is_locked": True}, format="json").data["is_locked"]
        )
        self.assertFalse(
            self.staff_client.post(url, {"is_locked": False}, format="json").data["is_locked"]
        )
        self.assertEqual(self._audit_count(), 2)

    def test_remove_and_restore(self):
        remove = self.staff_client.post(
            f"{BASE}forum-threads/{self.thread.id}/remove/", {"reason": "Spam"}, format="json"
        )
        again = self.staff_client.post(f"{BASE}forum-threads/{self.thread.id}/remove/")
        self.assertTrue(remove.data["is_removed"] and again.data["is_removed"])
        self.assertEqual(remove.data["removal_reason"], "Spam")
        self.assertEqual(self._audit_count(), 1)
        restored = self.staff_client.post(f"{BASE}forum-threads/{self.thread.id}/restore/")
        self.assertFalse(restored.data["is_removed"])
        self.assertEqual(self._audit_count(), 2)

    def test_move_adjusts_counts(self):
        self.general.refresh_from_db()
        before = self.general.thread_count
        response = self.staff_client.post(
            f"{BASE}forum-threads/{self.thread.id}/move/",
            {"category_id": self.news.id},
            format="json",
        )
        self.assertEqual(response.data["category"]["id"], self.news.id)
        self.general.refresh_from_db()
        self.news.refresh_from_db()
        self.assertEqual((self.general.thread_count, self.news.thread_count), (before - 1, 1))
        missing = self.staff_client.post(
            f"{BASE}forum-threads/{self.thread.id}/move/", {"category_id": 999999}, format="json"
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(self._audit_count(), 1)

    def test_hard_delete_is_superuser_only(self):
        url = f"{BASE}forum-threads/{self.thread.id}/"
        self.assertEqual(self.staff_client.delete(url).status_code, 403)
        self.assertEqual(self.root_client.delete(url).status_code, 204)
        self.assertFalse(Thread.objects.filter(pk=self.thread.id).exists())
        self.assertEqual(AuditLog.objects.get().action, "DELETE")

    # Posts

    def test_post_remove_and_restore(self):
        listed = self.staff_client.get(f"{BASE}forum-posts/?thread={self.thread.id}")
        self.assertEqual(listed.data["results"][0]["snippet"], "Reply")
        removed = self.staff_client.post(
            f"{BASE}forum-posts/{self.post.id}/remove/", {"reason": "Rude"}, format="json"
        )
        self.assertTrue(removed.data["is_removed"])
        self.assertEqual(removed.data["content"], "Reply")
        restored = self.staff_client.post(f"{BASE}forum-posts/{self.post.id}/restore/")
        self.assertFalse(restored.data["is_removed"])
        self.assertEqual(self._audit_count(), 2)


class GenreSlugTests(TestCase):
    def setUp(self):
        self.root_client = bearer_client(make_user("genre-root", role="superuser"))

    def test_a_blank_slug_is_made_from_the_name(self):
        made = self.root_client.post(
            "/api/v1/admin/genres/", {"name": "Slice of Life / Comedy", "slug": ""}, format="json"
        )
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["slug"], "slice-of-life-comedy")

    def test_names_are_unique_whatever_their_case(self):
        self.root_client.post("/api/v1/admin/genres/", {"name": "Action"}, format="json")
        clash = self.root_client.post("/api/v1/admin/genres/", {"name": "ACTION"}, format="json")
        self.assertEqual(clash.status_code, 400)
        self.assertEqual(clash.data["errors"]["name"][0], "A genre with this name already exists.")
