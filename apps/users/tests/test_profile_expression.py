"""Profile self-expression fields and taste compatibility."""

from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from ...animes.models import Anime
from ..models import UserAnimeList, UserProfile
from ..services.compatibility_service import _score, compatibility_label

User = get_user_model()

pytestmark = pytest.mark.django_db


def _user(username, **profile):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pw-123456!"
    )
    UserProfile.objects.update_or_create(user=user, defaults={"email_verified": True, **profile})
    return user


def _client(user=None):
    client = APIClient()
    if user:
        client.force_authenticate(user=user)
    return client


# --------------------------------------------------------------- expression


def test_patch_saves_expression_fields_and_payloads_carry_them():
    user = _user("ayaka")
    client = _client(user)
    response = client.patch(
        reverse("user_profile"),
        {
            "display_name": "  Ayaka   K. ",
            "pronouns": "she/her",
            "location": "Tashkent",
            "status_emoji": "🍜",
            "status_text": "rewatching Frieren",
            "hidden_sections": ["taste", "stats", "taste"],
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["display_name"] == "Ayaka K."
    assert response.data["pronouns"] == "she/her"
    assert response.data["location"] == "Tashkent"
    assert response.data["status_emoji"] == "🍜"
    assert response.data["status_text"] == "rewatching Frieren"
    assert response.data["hidden_sections"] == ["stats", "taste"]

    public = _client().get(reverse("public_user_profile", kwargs={"username": "ayaka"}))
    assert public.status_code == 200
    for field in ("display_name", "pronouns", "location", "status_emoji", "status_text"):
        assert public.data[field] == response.data[field]
    assert public.data["hidden_sections"] == ["stats", "taste"]


def test_blank_clears_and_omitted_fields_are_kept():
    user = _user("kei", display_name="Kei", pronouns="they/them")
    client = _client(user)
    response = client.patch(reverse("user_profile"), {"display_name": ""}, format="json")
    assert response.status_code == 200
    assert response.data["display_name"] == ""
    assert response.data["pronouns"] == "they/them"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("display_name", "x" * 41),
        ("status_text", "y" * 81),
        ("status_emoji", "abc"),
        ("status_emoji", "<b>"),
        ("hidden_sections", ["bio"]),
        ("hidden_sections", "not json"),
    ],
)
def test_invalid_expression_values_are_refused(field, value):
    user = _user("rin")
    response = _client(user).patch(reverse("user_profile"), {field: value}, format="json")
    assert response.status_code == 400
    profile = UserProfile.objects.get(user=user)
    assert getattr(profile, field) in ("", [])


def test_control_characters_are_dropped():
    user = _user("mio")
    sneaky = "Mio" + chr(0x202E) + chr(0x200B) + chr(10) + " Akiyama"
    response = _client(user).patch(reverse("user_profile"), {"display_name": sneaky}, format="json")
    assert response.status_code == 200
    assert response.data["display_name"] == "Mio Akiyama"


def test_old_cached_public_payload_reads_blank_fields():
    from django.core.cache import cache

    from ..services.cache import get_public_profile_cache_key

    _user("old")
    cache.set(
        get_public_profile_cache_key("old", "anonymous"), {"username": "old", "bio": None}, 300
    )
    response = _client().get(reverse("public_user_profile", kwargs={"username": "old"}))
    assert response.status_code == 200
    assert response.data["display_name"] == ""
    assert response.data["status_text"] == ""


# ------------------------------------------------------------ compatibility


def test_score_needs_overlap():
    assert _score({}, {1: 8}) == (0, [])
    assert _score({1: 8}, {2: 8}) == (0, [])


def test_identical_scores_rank_super_and_disagreement_lower():
    same = {1: 9, 2: 8, 3: 7, 4: 10}
    score, shared = _score(same, dict(same))
    assert score == 100
    assert compatibility_label(score) == "super"
    assert shared[0] == 4  # both gave it 10

    opposite = {1: 1, 2: 2, 3: 3, 4: 1}
    low, _ = _score(same, opposite)
    assert low < score
    assert compatibility_label(low) in {"medium", "low", "very_low", "high"}


def test_few_scores_cap_below_super():
    score, _ = _score({1: 0, 2: 0}, {1: 0, 2: 0})
    assert score == 75
    assert compatibility_label(score) == "high"


@patch("apps.animes.signals.request_hydrate", return_value=None)
@patch("apps.animes.signals.generate_recommendations")
def test_compatibility_endpoint(_recs, _hydrate):
    viewer = _user("viewer")
    target = _user("target")
    shows = [
        Anime.objects.create(title=f"Show {i}", slug=f"show-{i}", episode_count=12)
        for i in range(5)
    ]
    for index, anime in enumerate(shows[:4]):
        UserAnimeList.objects.create(
            user=viewer, anime=anime, status="Completed", score=8 + index % 2
        )
        UserAnimeList.objects.create(
            user=target, anime=anime, status="Completed", score=8 + index % 2
        )
    # Plan to Watch is not "seen".
    UserAnimeList.objects.create(user=viewer, anime=shows[4], status="Plan to Watch")
    UserAnimeList.objects.create(user=target, anime=shows[4], status="Plan to Watch")

    url = reverse("user_compatibility", kwargs={"username": "TARGET"})
    response = _client(viewer).get(url)
    assert response.status_code == 200, response.data
    assert response.data["score"] == 100
    assert response.data["label"] == "super"
    assert response.data["shared_count"] == 4
    assert {item["slug"] for item in response.data["shared"]} == {f"show-{i}" for i in range(4)}
    assert response.data["enough_data"] is True


def test_compatibility_requires_login_and_respects_privacy():
    viewer = _user("viewer2")
    _user("hidden", is_private=True)
    url = reverse("user_compatibility", kwargs={"username": "hidden"})
    assert _client().get(url).status_code == 401
    assert _client(viewer).get(url).status_code == 404
    assert (
        _client(viewer)
        .get(reverse("user_compatibility", kwargs={"username": "viewer2"}))
        .status_code
        == 400
    )


def test_hidden_sections_accept_form_json_and_clear(django_capture_on_commit_callbacks):
    user = _user("nao")
    client = _client(user)
    # Run the on-commit cache invalidation, as a real request would.
    with django_capture_on_commit_callbacks(execute=True):
        response = client.patch(
            reverse("user_profile"), {"hidden_sections": '["activity"]'}, format="multipart"
        )
    assert response.status_code == 200, response.data
    assert response.data["hidden_sections"] == ["activity"]
    with django_capture_on_commit_callbacks(execute=True):
        response = client.patch(reverse("user_profile"), {"hidden_sections": []}, format="json")
    assert response.data["hidden_sections"] == []
