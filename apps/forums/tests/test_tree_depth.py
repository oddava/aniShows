"""Reply depth contract, bounded post pages and the 0010 re-parent migration (spec 5 P0-1/P0-2)."""

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from ..messages import TOO_DEEP as TOO_DEEP_MESSAGE
from ..models import Post
from ..services.queries import MAX_DESCENDANTS_PER_PAGE
from .conftest import make_chain, make_reply

User = get_user_model()
POSTS_URL = reverse("forums:post-list")


@pytest.mark.django_db
def test_reply_to_a_depth_10_post_is_refused(make_user, make_thread, api_for):
    author = make_user()
    thread = make_thread(author)
    deepest = make_chain(thread, author, Post.MAX_DEPTH + 1)[-1]
    assert deepest.depth == Post.MAX_DEPTH

    response = api_for(author).post(
        POSTS_URL, {"thread": thread.id, "parent": deepest.id, "content": "x"}, format="json"
    )

    assert response.status_code == 400
    assert response.data["errors"]["parent"] == [TOO_DEEP_MESSAGE]
    assert not Post.objects.filter(parent=deepest).exists()


@pytest.mark.django_db
def test_reply_gets_parent_depth_plus_one(make_user, make_thread, api_for):
    author = make_user()
    thread = make_thread(author)
    parent = make_chain(thread, author, 9)[-1]

    response = api_for(author).post(
        POSTS_URL, {"thread": thread.id, "parent": parent.id, "content": "x"}, format="json"
    )

    assert response.status_code == 201
    assert response.data["depth"] == Post.MAX_DEPTH - 1
    assert response.data["can_reply"] is True


@pytest.mark.django_db
def test_every_level_of_a_full_chain_is_returned(make_user, make_thread):
    author = make_user()
    thread = make_thread(author)
    chain = make_chain(thread, author, Post.MAX_DEPTH + 1)

    response = APIClient().get(POSTS_URL, {"thread__id": thread.id})

    assert response.status_code == 200
    results = response.data["results"]
    assert [post["id"] for post in results] == [post.id for post in chain]
    by_id = {post["id"]: post for post in results}
    assert by_id[chain[-1].id]["can_reply"] is False
    assert by_id[chain[-2].id]["can_reply"] is True
    assert not any(post["has_hidden_replies"] for post in results)
    assert by_id[chain[0].id]["reply_count"] == 1


@pytest.mark.django_db
def test_root_returns_that_post_and_its_subtree(make_user, make_thread):
    author = make_user()
    thread = make_thread(author)
    chain = make_chain(thread, author, 5)
    sibling = make_reply(thread, author, chain[1])

    response = APIClient().get(POSTS_URL, {"thread__id": thread.id, "root": chain[2].id})

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["next"] is None
    assert [post["id"] for post in response.data["results"]] == [p.id for p in chain[2:]]
    assert sibling.id not in {post["id"] for post in response.data["results"]}


@pytest.mark.django_db
def test_root_from_another_thread_is_404_and_root_needs_a_thread(make_user, make_thread):
    author = make_user()
    thread = make_thread(author)
    elsewhere = make_reply(make_thread(author), author)

    client = APIClient()
    assert client.get(POSTS_URL, {"thread__id": thread.id, "root": elsewhere.id}).status_code == 404
    assert client.get(POSTS_URL, {"root": elsewhere.id}).status_code == 400
    assert client.get(POSTS_URL, {"thread__id": thread.id, "root": "x"}).status_code == 400


@pytest.mark.django_db
def test_descendants_are_capped_and_the_cut_parent_is_flagged(make_user, make_thread):
    author = make_user()
    thread = make_thread(author)
    top = make_reply(thread, author)
    Post.objects.bulk_create(
        Post(thread=thread, author=author, parent=top, depth=1, content=f"r{i}")
        for i in range(MAX_DESCENDANTS_PER_PAGE + 5)
    )

    results = APIClient().get(POSTS_URL, {"thread__id": thread.id}).data["results"]
    assert len(results) == 1 + MAX_DESCENDANTS_PER_PAGE
    top_payload = next(post for post in results if post["id"] == top.id)
    assert top_payload["has_hidden_replies"] is True
    assert top_payload["reply_count"] == MAX_DESCENDANTS_PER_PAGE + 5


@pytest.mark.django_db
def test_root_pages_its_direct_children_so_wide_trees_stay_reachable(make_user, make_thread):
    """Every one of 305 direct replies is reachable through ``?root=`` pages."""
    author = make_user()
    thread = make_thread(author)
    top = make_reply(thread, author)
    total = MAX_DESCENDANTS_PER_PAGE + 5
    Post.objects.bulk_create(
        Post(thread=thread, author=author, parent=top, depth=1, content=f"r{i}")
        for i in range(total)
    )
    client = APIClient()
    seen: set[int] = set()
    page = 1
    while True:
        data = client.get(
            POSTS_URL, {"thread__id": thread.id, "root": top.id, "page": page, "page_size": 50}
        ).data
        assert data["count"] == total
        assert data["results"][0]["id"] == top.id  # the root rides on every page
        seen |= {post["id"] for post in data["results"]} - {top.id}
        if not data["next"]:
            break
        page += 1
    assert page == 7
    assert seen == set(Post.objects.filter(parent=top).values_list("id", flat=True))


@pytest.mark.django_db
def test_page_size_is_clamped_to_50(make_user, make_thread):
    author = make_user()
    thread = make_thread(author)
    Post.objects.bulk_create(
        Post(thread=thread, author=author, content=f"p{i}", depth=0) for i in range(55)
    )
    client = APIClient()

    clamped = client.get(POSTS_URL, {"thread__id": thread.id, "page_size": 200}).data
    default = client.get(POSTS_URL, {"thread__id": thread.id}).data

    assert len(clamped["results"]) == 50
    assert clamped["count"] == 55
    assert len(default["results"]) == 20
    assert default["next"] is not None


@pytest.mark.django_db
def test_posts_of_an_unknown_thread_are_404():
    assert APIClient().get(POSTS_URL, {"thread__id": 999999}).status_code == 404


BEFORE = [("forums", "0009_community_moderation_subscriptions")]
AFTER = [("forums", "0010_community_reparent_deep_posts")]


class ReparentDeepPostsMigrationTests(TransactionTestCase):
    def tearDown(self):
        # Back to the latest state of every app for the tests that run next.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _apps_at(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def _seed_legacy_chain(self, apps, length):
        """A chain written by the old code: depth clamped at 10, parent links kept."""
        category = apps.get_model("forums", "Category").objects.create(name="C", slug="c")
        user = User.objects.create_user(username="old", email="old@example.com", password="x")
        thread = apps.get_model("forums", "Thread").objects.create(
            category=category, author_id=user.id, title="T", content="a &lt; b &amp;&amp; c"
        )
        post_model = apps.get_model("forums", "Post")
        ids, parent_id = [], None
        for level in range(length):
            post = post_model.objects.create(
                thread=thread,
                author_id=user.id,
                parent_id=parent_id,
                depth=min(level, 10),
                content="x &gt; y",
            )
            ids.append(post.id)
            parent_id = post.id
        return thread, user, ids

    def test_deep_chains_move_under_the_depth_9_ancestor_and_are_all_returned(self):
        thread, _user, ids = self._seed_legacy_chain(self._apps_at(BEFORE), 13)

        post_model = self._apps_at(AFTER).get_model("forums", "Post")
        rows = {row.id: row for row in post_model.objects.filter(id__in=ids)}
        depth_9_id = ids[9]
        for post_id in ids[10:]:
            assert rows[post_id].parent_id == depth_9_id
            assert rows[post_id].depth == 10
        for level, post_id in enumerate(ids[1:10], start=1):
            assert rows[post_id].parent_id == ids[level - 1]

        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        response = APIClient().get(POSTS_URL, {"thread__id": thread.id})
        assert sorted(post["id"] for post in response.data["results"]) == sorted(ids)

    def test_authors_are_subscribed_text_is_unescaped_and_reverse_undoes_both(self):
        thread, user, ids = self._seed_legacy_chain(self._apps_at(BEFORE), 1)

        after = self._apps_at(AFTER)
        assert after.get_model("forums", "Thread").objects.get(id=thread.id).content == (
            "a < b && c"
        )
        assert after.get_model("forums", "Post").objects.get(id=ids[0]).content == "x > y"
        subscription_model = after.get_model("forums", "ThreadSubscription")
        assert subscription_model.objects.filter(thread_id=thread.id, user_id=user.id).exists()
        other = User.objects.create_user(username="later", email="l@example.com", password="x")
        subscription_model.objects.create(thread_id=thread.id, user_id=other.id)

        before = self._apps_at(BEFORE)
        assert before.get_model("forums", "Thread").objects.get(id=thread.id).content == (
            "a &lt; b &amp;&amp; c"
        )
        remaining = before.get_model("forums", "ThreadSubscription").objects.filter(
            thread_id=thread.id
        )
        assert list(remaining.values_list("user_id", flat=True)) == [other.id]
