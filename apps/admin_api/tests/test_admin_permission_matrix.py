"""Every ``/api/v1/admin/`` route against ``ADMIN_ACTION_POLICY`` for every role (G6 P0-2).

The resolver is walked as before; each route and method is mapped to its view and
action, and then checked: anonymous -> 401/403, regular user -> 403, staff -> 403
exactly for superuser actions, superuser -> never 403 from the policy. Detail routes
use a pk that does not exist, so allowed actions stop at 404 without side effects.
"""

import re
from types import SimpleNamespace

import pytest
from django.urls import URLPattern, URLResolver, get_resolver, resolve
from rest_framework.test import APIClient

from ..permissions import (
    ADMIN_ACTION_POLICY,
    STAFF,
    SUPERUSER,
    AdminActionPermission,
    required_level,
)
from .helpers import bearer_client, make_user

ADMIN_PREFIX = "api/v1/admin/"
MISSING_PK = "987654"
METHODS = ("get", "post", "put", "patch", "delete")


def _walk(patterns, prefix=""):
    for entry in patterns:
        route = prefix + str(entry.pattern)
        if isinstance(entry, URLResolver):
            yield from _walk(entry.url_patterns, route)
        elif isinstance(entry, URLPattern):
            yield route


def _concrete(route: str) -> str:
    # Router patterns are regexes nested under a path prefix: drop every anchor.
    route = route.replace("^", "").replace("$", "").replace("\\.", ".")
    route = re.sub(r"\(\?P<\w+>[^)]*\)", MISSING_PK, route)
    route = re.sub(r"<(?:\w+:)?\w+>", MISSING_PK, route)
    return "/" + route.replace("\\/", "/")


ADMIN_URLS = sorted(
    {
        _concrete(route)
        for route in _walk(get_resolver().url_patterns)
        # DRF's ``.json``-style suffix routes map to the same views as the plain ones.
        if route.startswith(ADMIN_PREFIX) and "(?P<format>" not in route
    }
)


def _endpoints():
    """``(url, method, view class name, policy key)`` for every routed method."""
    for url in ADMIN_URLS:
        func = resolve(url).func
        view_class = getattr(func, "cls", None) or getattr(func, "view_class")  # noqa: B009
        actions = getattr(func, "actions", None)
        for method in METHODS:
            if actions is not None:
                action = actions.get(method)
            else:
                action = method if hasattr(view_class, method) else None
            if action is not None:
                yield url, method, view_class.__name__, action


ENDPOINTS = sorted(set(_endpoints()))


def _level(view_name: str, action: str) -> str:
    return ADMIN_ACTION_POLICY.get(view_name, {}).get(action, SUPERUSER)


def test_admin_routes_were_discovered():
    assert len(ADMIN_URLS) > 25
    assert len(ENDPOINTS) > 50


def test_every_routed_action_is_listed_in_the_policy():
    missing = sorted(
        {(view, action) for _, _, view, action in ENDPOINTS}
        - {(view, action) for view, actions in ADMIN_ACTION_POLICY.items() for action in actions}
    )
    assert missing == []


def test_policy_lists_no_stale_views_or_actions():
    routed = {(view, action) for _, _, view, action in ENDPOINTS}
    listed = {(view, action) for view, actions in ADMIN_ACTION_POLICY.items() for action in actions}
    assert sorted(listed - routed) == []


def test_unlisted_views_and_actions_fail_closed():
    class UnknownView:
        action = "list"

    class AdminUserViewSet:  # a real view name with an action the policy does not list
        action = "nuke_everything"

    permission = AdminActionPermission()
    staff = SimpleNamespace(
        is_authenticated=True, is_active=True, is_staff=True, is_superuser=False
    )
    root = SimpleNamespace(is_authenticated=True, is_active=True, is_staff=True, is_superuser=True)
    for view in (UnknownView(), AdminUserViewSet()):
        assert required_level(view, SimpleNamespace(method="GET")) == SUPERUSER
        assert not permission.has_permission(SimpleNamespace(user=staff, method="GET"), view)
        assert permission.has_permission(SimpleNamespace(user=root, method="GET"), view)


def test_inactive_staff_are_refused():
    permission = AdminActionPermission()
    inactive = SimpleNamespace(
        is_authenticated=True, is_active=False, is_staff=True, is_superuser=True
    )

    class AdminDashboardView:
        action = None

    assert not permission.has_permission(
        SimpleNamespace(user=inactive, method="GET"), AdminDashboardView()
    )


def _call(client, method, url):
    return getattr(client, method)(url, {}, format="json")


@pytest.mark.django_db
@pytest.mark.parametrize(("url", "method", "view", "action"), ENDPOINTS)
def test_anonymous_and_regular_users_are_refused(url, method, view, action):
    anonymous = _call(APIClient(), method, url)
    regular = _call(bearer_client(make_user("regular")), method, url)

    assert anonymous.status_code in (401, 403), (method, url, anonymous.status_code)
    assert regular.status_code == 403, (method, url, regular.status_code)


@pytest.mark.django_db
@pytest.mark.parametrize(("url", "method", "view", "action"), ENDPOINTS)
def test_staff_match_the_policy(url, method, view, action, monkeypatch):
    _offline_celery(monkeypatch)
    response = _call(bearer_client(make_user("staffer", role="staff")), method, url)

    if _level(view, action) == STAFF:
        assert response.status_code != 403, (method, url, response.data)
    else:
        assert response.status_code == 403, (method, url, response.status_code)


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("url", "method", "view", "action"),
    [endpoint for endpoint in ENDPOINTS if endpoint[1] == "get"],
)
def test_superusers_can_read_everything(url, method, view, action, monkeypatch):
    _offline_celery(monkeypatch)
    response = _call(bearer_client(make_user("root", role="superuser")), method, url)

    assert response.status_code not in (401, 403), (method, url, response.status_code)


def _no_send_task(*args, **kwargs):
    raise AssertionError("a permission-matrix request tried to send a Celery task")


def _offline_celery(monkeypatch):
    """No broker in tests: refuse task sends, and answer worker pings with nobody."""
    monkeypatch.setattr("celery.app.base.Celery.send_task", _no_send_task)
    monkeypatch.setattr("celery.app.control.Control.ping", lambda *a, **k: [])
    monkeypatch.setattr(
        "celery.app.control.Control.inspect",
        lambda *a, **k: SimpleNamespace(active=lambda: {}),
    )
