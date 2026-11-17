"""D-2 (owner decision): a direct link to an adult title shows an opt-in gate, not a 404.

Viewers who have not opted in (guests included) get ``403`` with code
``adult_content_opt_in_required`` and only the slug, from the detail endpoint
and from every per-title action. Opted-in viewers get the page, with
``is_adult: true``. The gate never poisons the shared detail cache.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.animes.models import Anime
from apps.animes.views.anime import ADULT_GATE_CODE
from apps.users.models import UserProfile

pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


@pytest.fixture
def adult():
    return Anime.objects.create(
        title="Explicit Show", slug="explicit-show", synopsis="explicit synopsis", is_adult=True
    )


@pytest.fixture
def general():
    return Anime.objects.create(
        title="The Apothecary Diaries",
        slug="the-apothecary-diaries",
        synopsis="a pharmacist in the palace",
        tags=["prostitution"],
    )


def _client(*, opted_in: bool | None):
    client = APIClient()
    if opted_in is None:
        return client
    user = User.objects.create_user(username=f"viewer{int(opted_in)}", password="pass12345!")
    UserProfile.objects.update_or_create(user=user, defaults={"show_adult_content": opted_in})
    client.force_authenticate(user=user)
    return client


@pytest.mark.parametrize("opted_in", [None, False], ids=["guest", "member-not-opted-in"])
def test_detail_shows_the_gate_and_nothing_about_the_title(adult, opted_in):
    response = _client(opted_in=opted_in).get(f"/api/v1/anime/{adult.slug}/")

    assert response.status_code == 403
    body = response.json()
    assert body["code"] == ADULT_GATE_CODE
    assert body["errors"] == {"slug": [adult.slug]}
    assert "Explicit Show" not in response.content.decode()
    assert "explicit synopsis" not in response.content.decode()
    assert "no-store" in response["Cache-Control"]


def test_opted_in_member_gets_the_page_with_the_flag(adult):
    response = _client(opted_in=True).get(f"/api/v1/anime/{adult.slug}/")

    assert response.status_code == 200
    assert response.json()["is_adult"] is True
    assert response.json()["title"] == "Explicit Show"


def test_the_gate_does_not_poison_the_shared_cache(adult):
    # A gated guest first, then an opted-in member: the member sees the page.
    assert APIClient().get(f"/api/v1/anime/{adult.slug}/").status_code == 403
    assert _client(opted_in=True).get(f"/api/v1/anime/{adult.slug}/").status_code == 200
    # And the other way round: a cached page is never served to a guest.
    assert APIClient().get(f"/api/v1/anime/{adult.slug}/").status_code == 403


def test_general_titles_are_unaffected(general):
    response = APIClient().get(f"/api/v1/anime/{general.slug}/")

    assert response.status_code == 200
    assert response.json()["is_adult"] is False


def test_unknown_slugs_are_still_404():
    response = APIClient().get("/api/v1/anime/no-such-show/")

    assert response.status_code == 404
    assert response.json()["code"] == "anime_not_found"


@pytest.mark.parametrize(
    "action", ["characters", "staff", "related", "recommendations", "reviews", "watch-episodes"]
)
def test_per_title_actions_follow_the_gate(adult, general, action):
    gated = APIClient().get(f"/api/v1/anime/{adult.slug}/{action}/")
    assert gated.status_code == 403
    assert gated.json()["code"] == ADULT_GATE_CODE

    assert _client(opted_in=True).get(f"/api/v1/anime/{adult.slug}/{action}/").status_code != 403
    assert APIClient().get(f"/api/v1/anime/{general.slug}/{action}/").status_code != 403
