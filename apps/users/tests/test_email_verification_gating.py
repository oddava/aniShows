from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from ...animes.models import Anime, Character, UserFavoriteCharacter
from ...forums.models import Category, Thread
from ..models import UserAnimeList, UserProfile

User = get_user_model()

# One write per feature that creates content or reaches other users.
GATED_WRITES = [
    ("post", "/api/v1/lists/", lambda ctx: {"anime_id": ctx["anime"].id}),
    ("post", "/api/v1/reviews/", lambda ctx: {"anime_slug": ctx["anime"].slug, "rating": 8}),
    ("post", "/api/v1/favorites/toggle/", lambda ctx: {"anime_id": ctx["anime"].id}),
    ("post", "/api/v1/forums/threads/", lambda ctx: {"category": ctx["category"].id, "title": "t", "content": "c"}),
    ("post", "/api/v1/forums/posts/", lambda ctx: {"thread": ctx["thread"].id, "content": "c"}),
    ("post", "/api/v1/follows/toggle/", lambda ctx: {"username": ctx["other"].username}),
    ("put", "/api/v1/anime/{slug}/episode-ratings/1/", lambda ctx: {"rating": 8}),
    ("post", "/api/v1/import/mal/", lambda ctx: {"username": "someone"}),
]


@pytest.fixture
def ctx(db):
    other = User.objects.create_user(username="other", email="o@example.com", password="x")
    category = Category.objects.create(name="General", slug="general")
    return {
        "anime": Anime.objects.create(title="A", slug="a", episode_count=12),
        "category": category,
        "thread": Thread.objects.create(category=category, author=other, title="t", content="c"),
        "other": other,
    }


def _client(username, *, verified, staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="x", is_staff=staff
    )
    UserProfile.objects.filter(user=user).update(email_verified=verified)
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


def _call(client, method, url, ctx, payload):
    return getattr(client, method)(url.format(slug=ctx["anime"].slug), payload(ctx), format="json")


@pytest.mark.parametrize("method,url,payload", GATED_WRITES)
def test_unverified_user_is_refused_with_a_specific_code(ctx, method, url, payload):
    _, client = _client("pending", verified=False)

    response = _call(client, method, url, ctx, payload)

    assert response.status_code == 403
    assert response.data["code"] == "email_verification_required"


@pytest.mark.parametrize("method,url,payload", GATED_WRITES)
def test_verified_user_passes_the_gate(ctx, method, url, payload):
    _, client = _client("verified", verified=True)

    response = _call(client, method, url, ctx, payload)

    assert response.data.get("code") != "email_verification_required"


@pytest.mark.parametrize("method,url,payload", GATED_WRITES)
def test_gate_follows_the_admin_setting(ctx, method, url, payload):
    _, client = _client("pending", verified=False)

    with patch("apps.users.permissions.is_email_verification_required", return_value=False):
        response = _call(client, method, url, ctx, payload)

    assert response.data.get("code") != "email_verification_required"


def test_staff_and_reads_are_not_gated(ctx):
    _, staff = _client("mod", verified=False, staff=True)
    assert staff.post("/api/v1/lists/", {"anime_id": ctx["anime"].id}, format="json").status_code == 201

    _, pending = _client("pending", verified=False)
    assert pending.get("/api/v1/lists/").status_code == 200


def test_unverified_user_can_still_delete_their_own_data(ctx):
    user, client = _client("pending", verified=False)
    entry = UserAnimeList.objects.create(user=user, anime=ctx["anime"], status="Watching")

    assert client.delete(f"/api/v1/lists/{entry.id}/").status_code == 204


def test_cannot_delete_someone_elses_character_favorite(ctx):
    character = Character.objects.create(name="C")
    favorite = UserFavoriteCharacter.objects.create(user=ctx["other"], character=character)
    _, client = _client("intruder", verified=True)

    response = client.delete(f"/api/v1/character-favorites/{favorite.id}/?username=other")

    assert response.status_code == 403
    assert UserFavoriteCharacter.objects.filter(pk=favorite.pk).exists()
