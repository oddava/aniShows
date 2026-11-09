"""Every admin API route must refuse non-staff users, whatever the method."""

import re

import pytest
from django.contrib.auth import get_user_model
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

User = get_user_model()

ADMIN_PREFIX = "api/v1/admin/"


def _walk(patterns, prefix=""):
    for entry in patterns:
        route = prefix + str(entry.pattern)
        if isinstance(entry, URLResolver):
            yield from _walk(entry.url_patterns, route)
        elif isinstance(entry, URLPattern):
            yield route


def _concrete(route: str) -> str:
    route = route.lstrip("^").rstrip("$").replace("\\.", ".")
    route = re.sub(r"\(\?P<format>[^)]*\)", "", route)
    route = re.sub(r"\(\?P<\w+>[^)]*\)", "1", route)
    route = re.sub(r"<(?:\w+:)?\w+>", "1", route)
    return "/" + route.replace("\\/", "/")


ADMIN_URLS = sorted(
    {_concrete(route) for route in _walk(get_resolver().url_patterns) if route.startswith(ADMIN_PREFIX)}
)


def test_admin_routes_were_discovered():
    assert len(ADMIN_URLS) > 20


@pytest.mark.django_db
@pytest.mark.parametrize("url", ADMIN_URLS)
def test_admin_route_refuses_regular_user(url):
    user = User.objects.create_user(username="regular", email="r@example.com", password="x")
    client = APIClient()
    client.force_authenticate(user=user)

    for method in ("get", "post", "put", "patch", "delete"):
        response = getattr(client, method)(url, {}, format="json")
        assert response.status_code in (403, 404, 405), (method, url, response.status_code)
