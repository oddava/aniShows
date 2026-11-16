"""Hostile-content limits and moderation edge cases (council round 1)."""

import threading
import time
from unittest import mock

import pytest
from django.conf import settings
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.exceptions import ValidationError

from ...core.models import Notification
from ..models import Post, Thread
from ..serializers import PostSerializer, ThreadSerializer
from ..services.excerpt import EXCERPT_SOURCE_LENGTH, build_excerpt
from ..services.interactions import create_post, update_post, update_thread
from ..services.mentions import notify_mentions
from ..services.moderation import lock_thread_then_post
from ..services.nesting import ContainerStats, container_stats, max_container_nesting
from .conftest import make_reply

POSTS_URL = reverse("forums:post-list")
THREADS_URL = reverse("forums:thread-list")
MENTION = Notification.NotificationType.FORUM_MENTION


def _post_url(post, action=None):
    if action is None:
        return reverse("forums:post-detail", args=[post.id])
    return reverse(f"forums:post-{action}", args=[post.id])


@pytest.fixture
def staff(make_user):
    return make_user("moderator", is_staff=True)


@pytest.mark.django_db
class TestContentLength:
    def test_post_longer_than_the_cap_is_400(self, make_user, make_thread, api_for):
        author = make_user()
        thread = make_thread(author)
        too_long = "x" * (settings.FORUM_CONTENT_MAX_LENGTH + 1)

        response = api_for(author).post(
            POSTS_URL, {"thread": thread.id, "content": too_long}, format="json"
        )

        assert response.status_code == 400
        assert "content" in response.data["errors"]
        assert not thread.posts.exists()

    def test_thread_longer_than_the_cap_is_400(self, make_user, api_for, forum_category):
        response = api_for(make_user()).post(
            THREADS_URL,
            {
                "category": forum_category.id,
                "title": "t",
                "content": "x" * (settings.FORUM_CONTENT_MAX_LENGTH + 1),
            },
            format="json",
        )

        assert response.status_code == 400
        assert "content" in response.data["errors"]

    def test_a_post_at_the_cap_is_accepted(self, make_user, make_thread, api_for):
        author = make_user()
        thread = make_thread(author)

        response = api_for(author).post(
            POSTS_URL,
            {"thread": thread.id, "content": "x" * settings.FORUM_CONTENT_MAX_LENGTH},
            format="json",
        )

        assert response.status_code == 201


@pytest.mark.django_db
class TestRemovedParents:
    def test_reply_to_a_removed_post_is_400_for_non_staff(
        self, make_user, make_thread, api_for, staff
    ):
        author = make_user()
        thread = make_thread(author)
        parent = make_reply(thread, author, content="rude")
        api_for(staff).post(_post_url(parent, "remove"), {}, format="json")

        response = api_for(make_user()).post(
            POSTS_URL, {"thread": thread.id, "parent": parent.id, "content": "hi"}, format="json"
        )

        assert response.status_code == 400
        assert "parent" in response.data["errors"]
        listed = api_for(author).get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert listed["can_reply"] is False

    def test_nobody_replies_under_a_removed_post_not_even_staff(
        self, make_user, make_thread, api_for, staff
    ):
        """Matches the UI, which never offers Reply on a removed post."""
        author = make_user()
        thread = make_thread(author)
        parent = make_reply(thread, author)
        api_for(staff).post(_post_url(parent, "remove"), {}, format="json")

        response = api_for(staff).post(
            POSTS_URL, {"thread": thread.id, "parent": parent.id, "content": "note"}, format="json"
        )

        assert response.status_code == 400
        staff_view = api_for(staff).get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert staff_view["can_reply"] is False


@pytest.mark.django_db
class TestRemovalKind:
    def test_staff_removing_their_own_post_is_a_moderator_removal(
        self, make_thread, api_for, staff
    ):
        post = make_reply(make_thread(staff), staff)

        api_for(staff).post(_post_url(post, "remove"), {}, format="json")

        post.refresh_from_db()
        assert (post.removal, post.removed_by_author) == ("moderator", False)

    def test_restore_clears_the_author_flag(self, make_user, make_thread, api_for, staff):
        author = make_user()
        thread = make_thread(author)
        post = make_reply(thread, author)
        make_reply(thread, make_user(), post)
        api_for(author).delete(_post_url(post))
        post.refresh_from_db()
        assert post.removal == "author"

        api_for(staff).post(_post_url(post, "restore"))

        post.refresh_from_db()
        assert (post.is_removed, post.removed_by_author, post.removal) == (False, False, None)

    def test_restore_broadcasts_post_restored(
        self, make_user, make_thread, api_for, staff, django_capture_on_commit_callbacks
    ):
        post = make_reply(make_thread(make_user()), make_user())
        api_for(staff).post(_post_url(post, "remove"), {}, format="json")

        with (
            mock.patch("apps.forums.services.events.broadcast_to_thread") as broadcast,
            django_capture_on_commit_callbacks(execute=True),
        ):
            api_for(staff).post(_post_url(post, "restore"))

        broadcast.assert_called_once_with(
            post.thread_id, {"type": "forum.post_restored", "post_id": post.id}
        )


@pytest.mark.django_db
def test_mention_cap_holds_across_edits(
    make_user, make_thread, api_for, django_capture_on_commit_callbacks
):
    author = make_user()
    first = [make_user(f"first{i}").username for i in range(10)]
    second = [make_user(f"second{i}").username for i in range(10)]
    post = make_reply(make_thread(author), author, content="hello")
    url = _post_url(post)
    client = api_for(author)

    for names in (first, second, first):
        with django_capture_on_commit_callbacks(execute=True):
            response = client.patch(
                url, {"content": " ".join(f"@{name}" for name in names)}, format="json"
            )
        assert response.status_code == 200

    mentions = Notification.objects.filter(notification_type=MENTION)
    assert mentions.count() == settings.FORUM_MAX_MENTIONS_PER_POST
    assert set(mentions.values_list("user__username", flat=True)) == set(first)
    assert Post.objects.get(pk=post.pk).mentions_notified == settings.FORUM_MAX_MENTIONS_PER_POST


class TestExcerpt:
    @pytest.mark.parametrize(
        ("content", "expected"),
        [
            ("a ||secret|| b >!more!< c", "a [spoiler] b [spoiler] c"),
            # An unclosed opener hides the rest: it may be a spoiler cut off by the slice.
            ("a ||secret and more", "a [spoiler]"),
        ],
    )
    def test_spoilers_become_placeholders(self, content, expected):
        assert build_excerpt(content) == expected

    def test_a_spoiler_cut_by_the_source_slice_does_not_leak(self):
        content = "x" * (EXCERPT_SOURCE_LENGTH - 3) + " ||secret|| tail"

        assert "secret" not in build_excerpt(content, max_length=EXCERPT_SOURCE_LENGTH)

    @pytest.mark.parametrize(
        "hostile",
        [
            ">!" * 50_000,
            "||a" * 50_000,
            "[" * 100_000,
            "@[" * 50_000,
            "\n" * 100_000,
            " \n" * 50_000,
            ">!x\n" * 50_000,
            "[a](" * 25_000,
        ],
    )
    def test_hostile_text_is_fast(self, hostile):
        started = time.perf_counter()
        build_excerpt(hostile)
        # The quadratic patterns took 100-300 ms on the 4k slice; linear ones take ~1 ms.
        assert time.perf_counter() - started < 0.05


def _request_for(user):
    return mock.Mock(user=user)


@pytest.mark.django_db
class TestWritesRecheckStateUnderLock:
    """A lock or removal can land between validation and the write; the write must see it."""

    def test_a_reply_validated_before_a_lock_is_refused(self, make_user, make_thread):
        author = make_user()
        thread = make_thread(author)
        serializer = PostSerializer(
            data={"thread": thread.id, "content": "late"},
            context={"request": _request_for(author)},
        )
        assert serializer.is_valid(), serializer.errors
        Thread.objects.filter(pk=thread.pk).update(is_locked=True)  # staff lock lands now

        with pytest.raises(ValidationError):
            create_post(serializer, author)

        assert not thread.posts.exists()

    def test_a_reply_validated_before_its_parent_is_removed_is_refused(
        self, make_user, make_thread
    ):
        author = make_user()
        thread = make_thread(author)
        parent = make_reply(thread, author)
        serializer = PostSerializer(
            data={"thread": thread.id, "parent": parent.id, "content": "late"},
            context={"request": _request_for(author)},
        )
        assert serializer.is_valid(), serializer.errors
        Post.objects.filter(pk=parent.pk).update(is_removed=True)

        with pytest.raises(ValidationError):
            create_post(serializer, author)

    def test_a_stale_post_edit_does_not_undo_a_removal(self, make_user, make_thread):
        author = make_user()
        post = make_reply(make_thread(author), author, content="rude")
        serializer = PostSerializer(
            post,
            data={"content": "edited"},
            partial=True,
            context={"request": _request_for(author)},
        )
        assert serializer.is_valid(), serializer.errors
        Post.objects.filter(pk=post.pk).update(is_removed=True)

        with pytest.raises(ValidationError):
            update_post(serializer)

        post.refresh_from_db()
        assert (post.is_removed, post.content) == (True, "rude")

    def test_a_stale_thread_edit_keeps_a_lock_that_landed_after_validation(
        self, make_user, make_thread
    ):
        author = make_user()
        thread = make_thread(author)
        request = _request_for(author)
        serializer = ThreadSerializer(
            thread, data={"title": "Renamed"}, partial=True, context={"request": request}
        )
        assert serializer.is_valid(), serializer.errors
        Thread.objects.filter(pk=thread.pk).update(is_locked=True, is_pinned=True)

        update_thread(serializer, request=request)

        thread.refresh_from_db()
        assert (thread.title, thread.is_locked, thread.is_pinned) == ("Renamed", True, True)


@pytest.mark.django_db
def test_post_writes_lock_the_thread_before_the_post(make_user, make_thread):
    """Replies lock thread then parent; removal/deletion must use the same order (no deadlock)."""
    post = make_reply(make_thread(make_user()), make_user())

    with CaptureQueriesContext(connection) as queries, transaction.atomic():
        lock_thread_then_post(post)

    locking = [q["sql"] for q in queries.captured_queries if "FOR UPDATE" in q["sql"]]
    assert len(locking) == 2
    assert '"forums_thread"' in locking[0].split("FROM", 1)[1].split("WHERE", 1)[0]
    assert '"forums_post"' in locking[1].split("FROM", 1)[1].split("WHERE", 1)[0]


@pytest.mark.django_db
class TestRemovedThreadsStayQuietLive:
    """Removed threads are staff-only: nothing new from them goes to the public channel."""

    def test_a_removed_thread_takes_no_replies_and_its_edits_stay_quiet(
        self, make_user, make_thread, api_for, staff, django_capture_on_commit_callbacks
    ):
        make_user("alice")
        thread = make_thread(make_user())
        mine = make_reply(thread, staff, content="before")
        thread.is_removed = True
        thread.save(update_fields=["is_removed"])

        with (
            mock.patch("apps.forums.services.events.broadcast_to_thread") as broadcast,
            django_capture_on_commit_callbacks(execute=True),
        ):
            created = api_for(staff).post(
                POSTS_URL, {"thread": thread.id, "content": "STAFF ONLY NOTE"}, format="json"
            )
            edited = api_for(staff).patch(
                _post_url(mine), {"content": "after @alice"}, format="json"
            )

        assert created.status_code == 400
        assert "thread" in created.data["errors"]
        assert edited.status_code == 200
        broadcast.assert_not_called()
        assert not Notification.objects.filter(notification_type=MENTION).exists()
        staff_view = api_for(staff).get(POSTS_URL, {"thread__id": thread.id}).data["results"][0]
        assert staff_view["can_reply"] is False

    def test_removing_a_thread_tells_its_channel(
        self, make_user, make_thread, api_for, staff, django_capture_on_commit_callbacks
    ):
        thread = make_thread(make_user())

        with (
            mock.patch("apps.forums.services.events.broadcast_to_thread") as broadcast,
            django_capture_on_commit_callbacks(execute=True),
        ):
            api_for(staff).post(
                reverse("forums:thread-remove", args=[thread.id]), {}, format="json"
            )

        broadcast.assert_called_once_with(
            thread.id, {"type": "forum.thread_removed", "thread_id": thread.id}
        )


@pytest.mark.django_db
def test_mention_budget_is_read_under_a_row_lock(make_user, make_thread):
    """Read-then-increment of ``mentions_notified`` runs under SELECT ... FOR UPDATE."""
    author = make_user()
    make_user("pal")
    post = make_reply(make_thread(author), author, content="hi @pal")

    with CaptureQueriesContext(connection) as queries:
        notify_mentions(author, post)

    sql = [q["sql"] for q in queries.captured_queries]
    lock_at = next(i for i, q in enumerate(sql) if "FOR UPDATE" in q and "forums_post" in q)
    bump_at = next(
        i for i, q in enumerate(sql) if q.startswith("UPDATE") and "mentions_notified" in q
    )
    assert lock_at < bump_at


@pytest.mark.django_db(transaction=True)
def test_concurrent_mention_reservations_share_one_budget(make_user, make_thread):
    """An edit's reservation that waits on another's lock sees the budget that one spent."""
    author = make_user()
    names = [make_user(f"late{i}").username for i in range(settings.FORUM_MAX_MENTIONS_PER_POST)]
    post = make_reply(make_thread(author), author, content=" ".join(f"@{n}" for n in names))
    holding_lock = threading.Event()

    def other_edit_spends_the_budget():
        try:
            with transaction.atomic():
                list(Post.objects.select_for_update().filter(pk=post.pk).values_list("pk"))
                holding_lock.set()
                time.sleep(0.5)
                Post.objects.filter(pk=post.pk).update(
                    mentions_notified=settings.FORUM_MAX_MENTIONS_PER_POST
                )
        finally:
            connection.close()

    worker = threading.Thread(target=other_edit_spends_the_budget)
    worker.start()
    assert holding_lock.wait(5)
    notify_mentions(author, post)  # waits for the worker, then finds no budget left
    worker.join(10)

    assert not Notification.objects.filter(notification_type=MENTION).exists()
    assert Post.objects.get(pk=post.pk).mentions_notified == settings.FORUM_MAX_MENTIONS_PER_POST


class TestNesting:
    @pytest.mark.parametrize(
        ("text", "depth"),
        [
            ("plain", 0),
            ("> quote", 1),
            ("> > - 1. item", 4),
            (">>>> x", 4),
            ("-----", 0),  # a separator, not a list
            ("- - -", 3),
            # Indentation counts half its columns (tab = 4): it continues open list items.
            ("   > three spaces indent", 2),
            ("    > four spaces", 3),
            ("\t- tabbed", 3),
            # The round-3 bypasses: markers continued on an indented line all nest.
            ("- - a\n    " + "- " * 100 + "a", 102),
            ("-\ta\n\t" + "- " * 100 + "a", 102),
            (" " * 64 + "- " * 16 + "a", 48),
            ("a\n> b\n> > c", 2),
        ],
    )
    def test_counts_leading_container_markers(self, text, depth):
        assert max_container_nesting(text) == depth

    def test_counting_is_linear(self):
        started = time.perf_counter()
        max_container_nesting("> " * 10_000 + "\n" + "- " * 10_000)
        assert time.perf_counter() - started < 0.05


@pytest.mark.django_db
@pytest.mark.parametrize("body", ["> " * 3_000 + "a", "- " * 2_000 + "a"])
def test_deeply_nested_bodies_are_refused(make_user, make_thread, api_for, body):
    """Bodies like these overflow or stall the markdown parser in every viewer's browser."""
    author = make_user()
    thread = make_thread(author)

    response = api_for(author).post(
        POSTS_URL, {"thread": thread.id, "content": body}, format="json"
    )

    assert response.status_code == 400
    assert "content" in response.data["errors"]


@pytest.mark.django_db
def test_nesting_at_the_cap_is_accepted(make_user, make_thread, api_for):
    author = make_user()
    thread = make_thread(author)
    body = "> " * settings.FORUM_MAX_CONTAINER_NESTING + "fine"

    response = api_for(author).post(
        POSTS_URL, {"thread": thread.id, "content": body}, format="json"
    )

    assert response.status_code == 201


class TestContainerBudget:
    def test_counts_markers_across_lines(self):
        assert container_stats("- a\n- b\n> > c\nplain") == ContainerStats(depth=2, markers=4)

    @pytest.mark.django_db
    def test_too_many_markers_in_total_is_400(self, make_user, make_thread, api_for):
        author = make_user()
        thread = make_thread(author)
        body = "- a\n" * (settings.FORUM_MAX_CONTAINER_MARKERS + 1)

        response = api_for(author).post(
            POSTS_URL, {"thread": thread.id, "content": body}, format="json"
        )

        assert response.status_code == 400
        assert "content" in response.data["errors"]

    @pytest.mark.django_db
    @pytest.mark.parametrize(
        "body",
        ["- - a\n    " + "- " * 2_000 + "a", "-\ta\n\t" + "- " * 2_000 + "a"],
    )
    def test_indented_continuation_bypasses_are_refused(
        self, make_user, make_thread, api_for, body
    ):
        author = make_user()
        thread = make_thread(author)

        response = api_for(author).post(
            POSTS_URL, {"thread": thread.id, "content": body}, format="json"
        )

        assert response.status_code == 400
