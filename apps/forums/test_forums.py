import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status

from apps.forums.models import Category, Post, PostLike, Tag, Thread, ThreadLike

User = get_user_model()

@pytest.fixture
def user(db):
    return User.objects.create_user(
        username="testuser", email="test@example.com", password="password123"
    )

@pytest.fixture
def api_client():
    from rest_framework.test import APIClient

    return APIClient()

@pytest.fixture
def authenticated_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client

@pytest.fixture
def category(db):
    return Category.objects.create(
        name="General Discussion", slug="general-discussion", description="Talk about anything"
    )

@pytest.fixture
def tag(db):
    return Tag.objects.create(name="News", slug="news", color="#FF0000")

@pytest.fixture
def thread(db, category, user):
    return Thread.objects.create(
        category=category, title="First Thread", author=user, content="Hello world"
    )

@pytest.mark.django_db
class TestForumsAPI:
    def test_list_categories(self, api_client, category):
        url = reverse("forums:category-list")
        response = api_client.get(url)
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["name"] == "General Discussion"

    def test_list_threads(self, api_client, thread):
        url = reverse("forums:thread-list")
        response = api_client.get(url)
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["title"] == "First Thread"

    def test_create_thread_unauthenticated(self, api_client, category):
        url = reverse("forums:thread-list")
        data = {"category": category.id, "title": "New Thread", "content": "Test content"}
        response = api_client.post(url, data)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_thread_authenticated(self, authenticated_client, category):
        url = reverse("forums:thread-list")
        data = {"category": category.id, "title": "New Thread", "content": "Test content"}
        response = authenticated_client.post(url, data)
        assert response.status_code == status.HTTP_201_CREATED
        assert Thread.objects.count() == 1  # assuming thread fixture isn't loaded for this test

    def test_create_post_authenticated(self, authenticated_client, thread):
        url = reverse("forums:post-list")
        data = {"thread": thread.id, "content": "This is a reply"}
        response = authenticated_client.post(url, data)
        assert response.status_code == status.HTTP_201_CREATED
        assert Post.objects.filter(thread=thread).count() == 1

    def test_list_posts(self, api_client, thread, user):
        Post.objects.create(thread=thread, author=user, content="A reply")
        url = reverse("forums:post-list")
        response = api_client.get(url, {"thread__id": thread.id})
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["content"] == "A reply"

    def test_create_thread_with_tags(self, authenticated_client, category, tag):
        url = reverse("forums:thread-list")
        data = {
            "category": category.id,
            "title": "Thread with Tags",
            "content": "Test tags",
            "tag_ids": [tag.id],
        }
        response = authenticated_client.post(url, data)
        assert response.status_code == status.HTTP_201_CREATED
        assert Thread.objects.get(id=response.data["id"]).tags.filter(id=tag.id).exists()

    def test_toggle_thread_like(self, authenticated_client, thread):
        # Like
        like_url = reverse("forums:thread-like", args=[thread.id])
        response = authenticated_client.post(like_url)
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["like_count"] == 1
        assert ThreadLike.objects.filter(thread=thread).count() == 1
        # Unlike (using separate unlike endpoint)
        unlike_url = reverse("forums:thread-unlike", args=[thread.id])
        response = authenticated_client.post(unlike_url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["like_count"] == 0
        assert ThreadLike.objects.filter(thread=thread).count() == 0

    def test_like_thread_is_idempotent(self, authenticated_client, thread):
        like_url = reverse("forums:thread-like", args=[thread.id])

        first = authenticated_client.post(like_url)
        second = authenticated_client.post(like_url)

        assert first.status_code == status.HTTP_201_CREATED
        assert first.data["like_count"] == 1
        assert second.status_code == status.HTTP_200_OK
        assert second.data["status"] == "already_liked"
        assert second.data["like_count"] == 1
        assert ThreadLike.objects.filter(thread=thread).count() == 1

    def test_global_feed(self, api_client, thread):
        url = reverse("forums:thread-list")
        response = api_client.get(url, {"ordering": "-updated_at"})
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) >= 1

    def test_toggle_pin_as_staff(self, api_client, thread, user):
        user.is_staff = True
        user.save()
        api_client.force_authenticate(user=user)
        url = reverse("forums:thread-toggle-pin", args=[thread.id])

        # Pin
        response = api_client.post(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_pinned"] is True
        assert response.data["status"] == "pinned"

        # Unpin
        response = api_client.post(url)
        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_pinned"] is False
        assert response.data["status"] == "unpinned"

    def test_toggle_pin_as_non_staff(self, authenticated_client, thread):
        url = reverse("forums:thread-toggle-pin", args=[thread.id])
        response = authenticated_client.post(url)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_toggle_pin_unauthenticated(self, api_client, thread):
        url = reverse("forums:thread-toggle-pin", args=[thread.id])
        response = api_client.post(url)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
