import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ..models import Category, Post, Thread

User = get_user_model()


@pytest.fixture
def author(db):
    return User.objects.create_user(username="author", email="a@example.com", password="x")


@pytest.fixture
def client_for(author):
    client = APIClient()
    client.force_authenticate(user=author)
    return client


@pytest.fixture
def category(db):
    return Category.objects.create(name="General", slug="general")


def _thread(category, author, **kwargs):
    return Thread.objects.create(category=category, author=author, title="T", content="c", **kwargs)


@pytest.mark.django_db
def test_cannot_reply_to_locked_thread(client_for, category, author):
    thread = _thread(category, author, is_locked=True)

    response = client_for.post(
        reverse("forums:post-list"), {"thread": thread.id, "content": "hi"}, format="json"
    )

    assert response.status_code == 400
    assert not Post.objects.filter(thread=thread).exists()


@pytest.mark.django_db
def test_staff_can_reply_to_locked_thread(category, author):
    thread = _thread(category, author, is_locked=True)
    staff = User.objects.create_user(username="mod", email="m@example.com", password="x", is_staff=True)
    client = APIClient()
    client.force_authenticate(user=staff)

    response = client.post(
        reverse("forums:post-list"), {"thread": thread.id, "content": "locked"}, format="json"
    )

    assert response.status_code == 201


@pytest.mark.django_db
def test_post_cannot_be_moved_by_update(client_for, category, author):
    home = _thread(category, author)
    other = _thread(category, author, is_locked=True)
    foreign_parent = Post.objects.create(thread=other, author=author, content="p")
    post = Post.objects.create(thread=home, author=author, content="mine")

    response = client_for.patch(
        reverse("forums:post-detail", args=[post.id]),
        {"thread": other.id, "parent": foreign_parent.id, "content": "edited"},
        format="json",
    )

    assert response.status_code == 200
    post.refresh_from_db()
    assert (post.thread_id, post.parent_id, post.content) == (home.id, None, "edited")


@pytest.mark.django_db
def test_filtered_thread_list_does_not_poison_shared_cache(category, author):
    other = User.objects.create_user(username="other", email="o@example.com", password="x")
    _thread(category, author)
    _thread(category, other)
    anon = APIClient()
    url = reverse("forums:thread-list")

    filtered = anon.get(url, {"author__username": "other", "ordering": "-updated_at"})
    assert len(filtered.data["results"]) == 1

    unfiltered = anon.get(url, {"ordering": "-updated_at"})
    assert len(unfiltered.data["results"]) == 2


@pytest.mark.django_db
def test_resized_post_page_does_not_poison_shared_cache(category, author):
    thread = _thread(category, author)
    Post.objects.create(thread=thread, author=author, content="first")
    Post.objects.create(thread=thread, author=author, content="second")
    anon = APIClient()
    url = reverse("forums:post-list")

    anon.get(url, {"thread__id": thread.id, "page_size": 1})
    response = anon.get(url, {"thread__id": thread.id})

    assert len(response.data["results"]) == 2


@pytest.mark.django_db
def test_new_thread_appears_in_cached_all_categories_list(
    client_for, category, django_capture_on_commit_callbacks
):
    anon = APIClient()
    url = reverse("forums:thread-list")
    assert anon.get(url, {"ordering": "-updated_at"}).data["results"] == []

    with django_capture_on_commit_callbacks(execute=True):
        created = client_for.post(
            url, {"category": category.id, "title": "New", "content": "body"}, format="json"
        )
    assert created.status_code == 201

    assert len(anon.get(url, {"ordering": "-updated_at"}).data["results"]) == 1
