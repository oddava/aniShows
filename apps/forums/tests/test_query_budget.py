"""Query budgets for the forum read endpoints (spec 5 test plan)."""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Post, Tag
from .conftest import make_reply


@pytest.fixture
def busy_forum(make_user, make_thread):
    authors = [make_user() for _ in range(5)]
    tag = Tag.objects.create(name="News", slug="news")
    threads = []
    for i in range(20):
        thread = make_thread(authors[i % 5], title=f"T{i}", content="**bold** ||spoiler||")
        thread.tags.add(tag)
        threads.append(thread)
    return authors, threads


@pytest.mark.django_db
@pytest.mark.parametrize("signed_in", [False, True])
def test_thread_list_of_20(busy_forum, api_for, django_assert_max_num_queries, signed_in):
    authors, _ = busy_forum
    client = api_for(authors[0]) if signed_in else APIClient()

    with django_assert_max_num_queries(6):
        response = client.get(reverse("forums:thread-list"))

    assert len(response.data["results"]) == 20


@pytest.mark.django_db
@pytest.mark.parametrize("signed_in", [False, True])
def test_thread_detail(busy_forum, api_for, django_assert_max_num_queries, signed_in):
    authors, threads = busy_forum
    client = api_for(authors[1]) if signed_in else APIClient()

    with django_assert_max_num_queries(6):
        response = client.get(reverse("forums:thread-detail", args=[threads[0].id]))

    assert response.status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize("signed_in", [False, True])
def test_posts_page_of_20_with_40_replies(
    busy_forum, api_for, django_assert_max_num_queries, signed_in
):
    authors, threads = busy_forum
    thread = threads[0]
    for i in range(20):
        top = make_reply(thread, authors[i % 5])
        Post.objects.bulk_create(
            Post(thread=thread, author=authors[(i + n) % 5], parent=top, depth=1, content="r")
            for n in range(2)
        )
    client = api_for(authors[2]) if signed_in else APIClient()

    with django_assert_max_num_queries(8):
        response = client.get(reverse("forums:post-list"), {"thread__id": thread.id})

    assert len(response.data["results"]) == 60
