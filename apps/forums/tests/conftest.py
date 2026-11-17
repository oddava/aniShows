"""Shared helpers for the forum tests added with the community revamp."""

import itertools

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from ...users.models import UserProfile
from ..models import Category, Post, Thread

User = get_user_model()
_sequence = itertools.count()


@pytest.fixture
def make_user(db):
    def _make(username: str | None = None, **extra):
        name = username or f"user{next(_sequence)}"
        user = User.objects.create_user(
            username=name, email=f"{name}@example.com", password="x", **extra
        )
        UserProfile.objects.filter(user=user).update(email_verified=True)
        return user

    return _make


@pytest.fixture
def api_for():
    def _client(user=None) -> APIClient:
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        return client

    return _client


@pytest.fixture
def forum_category(db):
    return Category.objects.create(name="General", slug="general")


@pytest.fixture
def make_thread(forum_category):
    def _make(author, **fields):
        fields.setdefault("title", "Thread")
        fields.setdefault("content", "Body")
        return Thread.objects.create(category=forum_category, author=author, **fields)

    return _make


def make_reply(thread, author, parent=None, **fields) -> Post:
    """A post with the depth the API would give it."""
    fields.setdefault("content", "reply")
    depth = parent.depth + 1 if parent is not None else 0
    return Post.objects.create(thread=thread, author=author, parent=parent, depth=depth, **fields)


def make_chain(thread, author, length: int) -> list[Post]:
    """``length`` posts, each replying to the previous one (depths 0..length-1)."""
    chain: list[Post] = []
    for _ in range(length):
        chain.append(make_reply(thread, author, chain[-1] if chain else None))
    return chain
