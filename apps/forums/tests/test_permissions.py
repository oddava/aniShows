"""Edit/delete authorization, category moves, locking and staff moderation (spec 5 P0-3, P1-1)."""

from unittest import mock

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from ...core.models import AuditLog
from ..models import Category, Post, Thread
from ..views import CommunityActionRateThrottle
from .conftest import make_reply

POSTS_URL = reverse("forums:post-list")
THREADS_URL = reverse("forums:thread-list")


def _thread_url(thread, action=None):
    if action is None:
        return reverse("forums:thread-detail", args=[thread.id])
    return reverse(f"forums:thread-{action}", args=[thread.id])


def _post_url(post, action=None):
    if action is None:
        return reverse("forums:post-detail", args=[post.id])
    return reverse(f"forums:post-{action}", args=[post.id])


def _audit_operations(entity_type):
    return list(
        AuditLog.objects.filter(entity_type=entity_type)
        .order_by("timestamp", "id")
        .values_list("metadata__operation", flat=True)
    )


@pytest.fixture
def staff(make_user):
    return make_user("moderator", is_staff=True)


@pytest.mark.django_db
class TestOwnership:
    def test_others_cannot_edit_or_delete_a_thread_or_post(self, make_user, make_thread, api_for):
        author, intruder = make_user(), make_user()
        thread = make_thread(author)
        post = make_reply(thread, author)
        client = api_for(intruder)

        assert client.patch(_thread_url(thread), {"title": "x"}, format="json").status_code == 403
        assert client.delete(_thread_url(thread)).status_code == 403
        assert client.patch(_post_url(post), {"content": "x"}, format="json").status_code == 403
        assert client.delete(_post_url(post)).status_code == 403
        thread.refresh_from_db()
        post.refresh_from_db()
        assert (thread.title, post.content) == ("Thread", "reply")

    def test_staff_cannot_edit_or_delete_others_posts(self, make_user, make_thread, api_for, staff):
        author = make_user()
        post = make_reply(make_thread(author), author)
        client = api_for(staff)

        assert client.patch(_post_url(post), {"content": "x"}, format="json").status_code == 403
        assert client.delete(_post_url(post)).status_code == 403

    def test_deleting_a_user_keeps_their_threads_and_posts_as_deleted_user(
        self, make_user, make_thread, api_for
    ):
        """D-6 (owner decision): content stays; the author becomes "deleted user"."""
        author, other = make_user(), make_user()
        own_thread = make_thread(author)
        others_reply = make_reply(own_thread, other)
        other_thread = make_thread(other)
        own_reply = make_reply(other_thread, author)
        reply_to_own = make_reply(other_thread, other, parent=own_reply)

        author.delete()

        own_thread.refresh_from_db()
        own_reply.refresh_from_db()
        assert own_thread.author_id is None and own_reply.author_id is None
        # Everyone else's replies under the deleted account's thread survive.
        assert Post.objects.filter(pk__in=[others_reply.pk, reply_to_own.pk]).count() == 2
        assert "deleted user" in str(own_reply)

        client = api_for(other)
        thread_body = client.get(_thread_url(own_thread)).json()
        assert thread_body["author"] is None
        posts = client.get(POSTS_URL, {"thread": other_thread.id}).json()
        rows = posts.get("results", posts)
        by_id = {row["id"]: row for row in rows}
        assert by_id[own_reply.pk]["author"] is None
        assert by_id[own_reply.pk]["content"] == "reply"

        # Replying under a deleted account's thread or post notifies nobody, and works.
        reply = client.post(
            POSTS_URL, {"thread": own_thread.id, "content": "still here"}, format="json"
        )
        assert reply.status_code == 201
        nested = client.post(
            POSTS_URL,
            {"thread": other_thread.id, "parent": own_reply.id, "content": "and here"},
            format="json",
        )
        assert nested.status_code == 201

        # A subscriber notification queued before the deletion sends nothing.
        from ..services.subscriptions import notify_thread_subscribers

        assert notify_thread_subscribers(own_reply.pk) == 0

        # Likes on the deleted account's content work and notify nobody.
        with mock.patch("apps.forums.services.interactions.notify") as notify:
            assert client.post(_thread_url(own_thread, "like")).status_code in (200, 201)
            assert client.post(_post_url(own_reply, "like")).status_code in (200, 201)
        notify.assert_not_called()

    def test_deleting_a_user_drops_cached_forum_pages_that_named_them(
        self, make_user, make_thread, api_for, forum_category, django_capture_on_commit_callbacks
    ):
        """The page caches serve anonymous visitors only, so warm them anonymously."""
        author = make_user()
        thread = make_thread(author)
        make_reply(thread, author)
        guest = api_for()
        category_url = reverse("forums:category-detail", args=[forum_category.slug])
        post_params = {"thread__id": thread.id}

        def latest_author(body):
            latest = body.get("latest_thread") or {}
            return latest.get("author")

        # Warm every cache that names the author, and prove it is cached.
        assert guest.get(THREADS_URL).status_code == 200
        assert guest.get(_thread_url(thread)).json()["author"]["username"] == author.username
        posts = guest.get(POSTS_URL, post_params).json()
        assert posts["results"][0]["author"]["username"] == author.username
        assert latest_author(guest.get(category_url).json()) == author.username

        with django_capture_on_commit_callbacks(execute=True):
            author.delete()

        rows = guest.get(THREADS_URL).json()
        rows = rows.get("results", rows)
        assert [row["author"] for row in rows if row["id"] == thread.id] == [None]
        assert guest.get(_thread_url(thread)).json()["author"] is None
        posts = guest.get(POSTS_URL, post_params).json()
        assert [row["author"] for row in posts["results"]] == [None]
        assert latest_author(guest.get(category_url).json()) in (None, "")


@pytest.mark.django_db
class TestCategoryMove:
    def test_author_cannot_move_a_thread(self, make_user, make_thread, api_for, forum_category):
        author = make_user()
        thread = make_thread(author)
        forum_category.refresh_from_db()
        other = Category.objects.create(name="Other", slug="other")

        response = api_for(author).patch(
            _thread_url(thread), {"category": other.id, "title": "Renamed"}, format="json"
        )

        assert response.status_code == 200
        thread.refresh_from_db()
        other.refresh_from_db()
        assert (thread.category_id, thread.title) == (forum_category.id, "Renamed")
        assert other.thread_count == 0

    def test_staff_move_adjusts_both_counts_and_is_audited(
        self, make_user, make_thread, api_for, forum_category, staff
    ):
        thread = make_thread(make_user())
        other = Category.objects.create(name="Other", slug="other")

        response = api_for(staff).patch(
            _thread_url(thread), {"category": other.id, "title": "Hijacked"}, format="json"
        )

        assert response.status_code == 200
        thread.refresh_from_db()
        forum_category.refresh_from_db()
        other.refresh_from_db()
        assert (thread.category_id, thread.title) == (other.id, "Thread")
        assert (forum_category.thread_count, other.thread_count) == (0, 1)
        assert _audit_operations("forum_thread") == ["forum.thread.move"]


@pytest.mark.django_db
class TestLocking:
    def test_staff_lock_blocks_replies_and_is_audited(self, make_user, make_thread, api_for, staff):
        author = make_user()
        thread = make_thread(author)

        locked = api_for(staff).post(_thread_url(thread, "toggle-lock"))
        reply = api_for(author).post(
            POSTS_URL, {"thread": thread.id, "content": "hi"}, format="json"
        )
        unlocked = api_for(staff).post(_thread_url(thread, "toggle-lock"))

        assert locked.data == {"status": "locked", "is_locked": True}
        assert reply.status_code == 400
        assert reply.data["errors"]["thread"] == ["This thread is locked."]
        assert unlocked.data == {"status": "unlocked", "is_locked": False}
        assert _audit_operations("forum_thread") == ["forum.thread.lock", "forum.thread.unlock"]

    def test_moderation_actions_are_staff_only(self, make_user, make_thread, api_for):
        author = make_user()
        thread = make_thread(author)
        post = make_reply(thread, author)
        client = api_for(author)

        for url in (
            _thread_url(thread, "toggle-lock"),
            _thread_url(thread, "remove"),
            _thread_url(thread, "restore"),
            _post_url(post, "remove"),
            _post_url(post, "restore"),
        ):
            assert client.post(url).status_code == 403
            assert APIClient().post(url).status_code == 401
        assert not AuditLog.objects.exists()

    def test_moderation_actions_are_throttled(
        self, make_user, make_thread, api_for, staff, monkeypatch
    ):
        thread = make_thread(make_user())
        cache.clear()
        monkeypatch.setattr(CommunityActionRateThrottle, "rate", "2/minute", raising=False)

        codes = [
            api_for(staff).post(_thread_url(thread, "toggle-lock")).status_code for _ in range(3)
        ]

        assert codes == [200, 200, 429]


@pytest.mark.django_db
class TestThreadRemoval:
    def test_removed_thread_is_hidden_and_counted_out_until_restored(
        self,
        make_user,
        make_thread,
        api_for,
        forum_category,
        staff,
        django_capture_on_commit_callbacks,
    ):
        author = make_user()
        thread = make_thread(author)
        make_reply(thread, author)
        anon = APIClient()
        assert len(anon.get(THREADS_URL).data["results"]) == 1  # warm the public cache

        with django_capture_on_commit_callbacks(execute=True):
            removed = api_for(staff).post(
                _thread_url(thread, "remove"), {"reason": "spam"}, format="json"
            )

        assert removed.data == {"status": "removed", "is_removed": True}
        forum_category.refresh_from_db()
        assert forum_category.thread_count == 0
        assert anon.get(THREADS_URL).data["results"] == []
        assert api_for(staff).get(THREADS_URL).data["results"] == []
        for client in (anon, api_for(author)):
            assert client.get(_thread_url(thread)).status_code == 404
            assert client.get(POSTS_URL, {"thread__id": thread.id}).status_code == 404
            reply = client.post(POSTS_URL, {"thread": thread.id, "content": "x"}, format="json")
            assert reply.status_code in (400, 401)
        staff_view = api_for(staff).get(_thread_url(thread)).data
        assert (staff_view["is_removed"], staff_view["removal_reason"]) == (True, "spam")

        with django_capture_on_commit_callbacks(execute=True):
            restored = api_for(staff).post(_thread_url(thread, "restore"))

        assert restored.data == {"status": "restored", "is_removed": False}
        forum_category.refresh_from_db()
        assert forum_category.thread_count == 1
        assert len(anon.get(THREADS_URL).data["results"]) == 1
        detail = api_for(author).get(_thread_url(thread)).data
        assert (detail["is_removed"], detail["removal_reason"]) == (False, "")
        assert _audit_operations("forum_thread") == ["forum.thread.remove", "forum.thread.restore"]
        assert (
            AuditLog.objects.get(metadata__operation="forum.thread.remove").metadata["reason"]
            == "spam"
        )

    def test_repeated_remove_changes_nothing(
        self, make_user, make_thread, api_for, forum_category, staff
    ):
        thread = make_thread(make_user())
        client = api_for(staff)

        client.post(_thread_url(thread, "remove"))
        again = client.post(_thread_url(thread, "remove"))

        assert again.status_code == 200
        forum_category.refresh_from_db()
        assert forum_category.thread_count == 0
        assert AuditLog.objects.count() == 1

    def test_reason_longer_than_200_is_rejected(self, make_user, make_thread, api_for, staff):
        thread = make_thread(make_user())

        response = api_for(staff).post(
            _thread_url(thread, "remove"), {"reason": "x" * 201}, format="json"
        )

        assert response.status_code == 400
        thread.refresh_from_db()
        assert thread.is_removed is False


@pytest.mark.django_db
class TestPostRemoval:
    def test_removed_post_is_a_placeholder_for_everyone_but_staff(
        self, make_user, make_thread, api_for, staff, django_capture_on_commit_callbacks
    ):
        author = make_user()
        thread = make_thread(author)
        post = make_reply(thread, author, content="rude")
        thread.refresh_from_db()
        assert thread.reply_count == 1
        anon = APIClient()
        assert anon.get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]["content"] == (
            "rude"
        )  # cached for anonymous readers

        with django_capture_on_commit_callbacks(execute=True):
            api_for(staff).post(_post_url(post, "remove"), {"reason": "abuse"}, format="json")

        public = anon.get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert (public["content"], public["author"], public["is_removed"]) == ("", None, True)
        assert (public["removal"], public["removal_reason"]) == ("moderator", "")
        staff_view = api_for(staff).get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert (staff_view["content"], staff_view["removal_reason"]) == ("rude", "abuse")
        thread.refresh_from_db()
        assert thread.reply_count == 0
        like = api_for(make_user()).post(_post_url(post, "like"))
        assert like.status_code == 400

        with django_capture_on_commit_callbacks(execute=True):
            api_for(staff).post(_post_url(post, "restore"))

        restored = anon.get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert (restored["content"], restored["removal"]) == ("rude", None)
        thread.refresh_from_db()
        assert thread.reply_count == 1
        assert _audit_operations("forum_post") == ["forum.post.remove", "forum.post.restore"]

    def test_author_delete_soft_removes_a_post_with_replies(self, make_user, make_thread, api_for):
        author, replier = make_user(), make_user()
        thread = make_thread(author)
        parent = make_reply(thread, author)
        make_reply(thread, replier, parent)
        leaf = make_reply(thread, author)

        assert api_for(author).delete(_post_url(parent)).status_code == 204
        assert api_for(author).delete(_post_url(leaf)).status_code == 204

        parent.refresh_from_db()
        assert (parent.is_removed, parent.removal) == (True, "author")
        assert not Post.objects.filter(pk=leaf.pk).exists()
        thread.refresh_from_db()
        assert thread.reply_count == 1
        assert not AuditLog.objects.exists()
        # Deleting the placeholder again (no new replies) changes nothing.
        assert api_for(author).delete(_post_url(parent)).status_code == 204
        thread.refresh_from_db()
        assert thread.reply_count == 1

    def test_removed_post_cannot_be_edited(self, make_user, make_thread, api_for, staff):
        author = make_user()
        post = make_reply(make_thread(author), author)
        api_for(staff).post(_post_url(post, "remove"))

        response = api_for(author).patch(_post_url(post), {"content": "back"}, format="json")

        assert response.status_code == 400
        post.refresh_from_db()
        assert post.content == "reply"


@pytest.mark.django_db
class TestThreadDelete:
    def test_thread_with_others_replies_is_409(self, make_user, make_thread, api_for):
        author = make_user()
        thread = make_thread(author)
        make_reply(thread, make_user())

        response = api_for(author).delete(_thread_url(thread))

        assert response.status_code == 409
        assert response.data == {
            "detail": "Threads with replies can only be removed by a moderator.",
            "code": "thread_has_replies",
        }
        assert Thread.objects.filter(pk=thread.pk).exists()

    def test_thread_with_only_own_replies_is_deleted(
        self, make_user, make_thread, api_for, forum_category
    ):
        author = make_user()
        thread = make_thread(author)
        make_reply(thread, author)

        assert api_for(author).delete(_thread_url(thread)).status_code == 204
        assert not Thread.objects.filter(pk=thread.pk).exists()
        forum_category.refresh_from_db()
        assert forum_category.thread_count == 0
