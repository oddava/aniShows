"""Admin list endpoints keep a flat query count as rows grow (G6 P1-5).

Each endpoint is measured with 3 rows and with 15 rows under the same limit; the
count is fixed, not "per row". The budgets are the endpoints' own (spec 6); every
authenticated request also pays ``REQUEST_OVERHEAD``: the JWT user lookup and G1's
once-a-minute ``last_activity`` stamp.
"""

from types import SimpleNamespace

import pytest

from ...animes.models import Anime, Review, ReviewReport, UserFavorite
from ...core.models import AuditLog, SystemLog
from ...users.models import UserAnimeList
from .helpers import bearer_client, make_user

BUDGETS = {
    "/api/v1/admin/users/": 4,
    "/api/v1/admin/anime/": 5,
    "/api/v1/admin/reviews/": 3,
    "/api/v1/admin/moderation/reviews/": 4,
    "/api/v1/admin/logs/": 3,
    "/api/v1/admin/audit-logs/": 3,
}
REQUEST_OVERHEAD = 2
DASHBOARD_BUDGET = 12
SYSTEM_BUDGET = 6


@pytest.fixture(autouse=True)
def _quiet_signals(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


def _seed(rows: int, root):
    for index in range(rows):
        user = make_user(f"budget-u{index}-{rows}")
        anime = Anime.objects.create(
            title=f"Budget {rows}-{index}",
            slug=f"budget-{rows}-{index}",
            synopsis="x",
            status="Airing",
            anime_type="TV",
        )
        review = Review.objects.create(user=user, anime=anime, rating=5, text="t")
        ReviewReport.objects.create(review=review, reporter=root, reason="spam")
        UserFavorite.objects.create(user=user, anime=anime)
        UserAnimeList.objects.create(user=user, anime=anime, status="Watching")
        SystemLog.objects.create(message=f"log {index}", user=user)
        AuditLog.objects.create(
            action="UPDATE", entity_type="User", entity_id=str(user.id), user=root
        )


def _count(client, url, django_assert_max_num_queries, budget):
    with django_assert_max_num_queries(budget + REQUEST_OVERHEAD):
        response = client.get(url)
    assert response.status_code == 200, response.data


@pytest.mark.django_db
@pytest.mark.parametrize("rows", [3, 15])
@pytest.mark.parametrize(("url", "budget"), sorted(BUDGETS.items()))
def test_list_endpoints_stay_within_budget(url, budget, rows, django_assert_max_num_queries):
    root = make_user(f"budget-root-{rows}", role="superuser")
    _seed(rows, root)
    _count(bearer_client(root), url, django_assert_max_num_queries, budget)


@pytest.mark.django_db
@pytest.mark.parametrize("rows", [3, 15])
def test_dashboard_cold_budget(rows, django_assert_max_num_queries):
    root = make_user(f"dash-root-{rows}", role="superuser")
    _seed(rows, root)
    _count(
        bearer_client(root),
        "/api/v1/admin/dashboard/?refresh=1",
        django_assert_max_num_queries,
        DASHBOARD_BUDGET,
    )


@pytest.mark.django_db
@pytest.mark.parametrize("rows", [3, 15])
def test_system_cold_budget(rows, django_assert_max_num_queries, monkeypatch):
    from ..services import system_service

    control = SimpleNamespace(
        ping=lambda **k: [], inspect=lambda **k: SimpleNamespace(active=lambda: {})
    )
    monkeypatch.setattr(system_service.current_app, "control", control, raising=False)
    monkeypatch.setattr(system_service, "get_queue_sizes", lambda names: None)
    monkeypatch.setattr(system_service, "_migrations_pending", lambda: {"pending": False})
    root = make_user(f"sys-root-{rows}", role="superuser")
    _seed(rows, root)
    _count(
        bearer_client(root),
        "/api/v1/admin/system/?refresh=1",
        django_assert_max_num_queries,
        SYSTEM_BUDGET,
    )
