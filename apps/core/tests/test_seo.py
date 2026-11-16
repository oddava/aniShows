"""robots.txt and the sitemap (apps/core/views/seo.py)."""

from unittest import mock
from xml.etree import ElementTree

import pytest
from django.core.cache import cache
from django.test import override_settings

from apps.animes.models import Anime
from apps.core.views import seo

NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


def _locs(response) -> list[str]:
    root = ElementTree.fromstring(response.content)  # noqa: S314 - our own output
    return [element.text or "" for element in root.iter(f"{{{NS['s']}}}loc")]


@override_settings(FRONTEND_URL="https://anishows.example/")
def test_robots_points_at_the_sitemap_and_keeps_crawlers_out_of_account_pages(client):
    response = client.get("/robots.txt")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/plain")
    body = response.content.decode()
    assert "Sitemap: https://anishows.example/sitemap.xml" in body
    assert "Disallow: /settings" in body
    assert "Disallow: /reset-password/" in body


@override_settings(FRONTEND_URL="https://anishows.example")
def test_sitemap_lists_public_non_adult_anime_only(client):
    public = Anime.objects.create(title="Frieren", slug="frieren", synopsis="s")
    Anime.objects.create(title="Adult", slug="adult-title", synopsis="s", is_adult=True)

    index = client.get("/sitemap.xml")
    assert index.status_code == 200
    assert _locs(index) == [
        "https://anishows.example/sitemap-pages.xml",
        "https://anishows.example/sitemap-anime-1.xml",
    ]

    pages = _locs(client.get("/sitemap-pages.xml"))
    assert "https://anishows.example/browse" in pages

    anime = client.get("/sitemap-anime-1.xml")
    assert anime.status_code == 200
    assert anime["Content-Type"].startswith("application/xml")
    assert _locs(anime) == [f"https://anishows.example/anime/{public.slug}"]


@override_settings(FRONTEND_URL="https://anishows.example")
def test_anime_files_split_and_out_of_range_is_404(client):
    for number in range(5):
        Anime.objects.create(title=f"Show {number}", slug=f"show-{number}", synopsis="s")
    with mock.patch.object(seo, "ANIME_PER_FILE", 2):
        cache.clear()
        assert len(_locs(client.get("/sitemap.xml"))) == 1 + 3
        assert len(_locs(client.get("/sitemap-anime-3.xml"))) == 1
        assert client.get("/sitemap-anime-4.xml").status_code == 404
    assert client.get("/sitemap-anime-0.xml").status_code == 404


def test_cache_outage_still_serves(client):
    from redis.exceptions import ConnectionError as RedisConnectionError

    with (
        mock.patch.object(cache, "get", side_effect=RedisConnectionError("down")),
        mock.patch.object(cache, "set", side_effect=RedisConnectionError("down")),
    ):
        assert client.get("/sitemap.xml").status_code == 200


@override_settings(FRONTEND_URL="https://anishows.example")
def test_a_title_hidden_after_caching_leaves_the_sitemap_at_once(client):
    from apps.animes.adult_content import apply_anilist_adult_flags

    anime = Anime.objects.create(
        title="Later Adult", slug="later-adult", synopsis="s", anilist_id=77
    )
    assert _locs(client.get("/sitemap-anime-1.xml")) == [
        "https://anishows.example/anime/later-adult"
    ]

    from django.test import TestCase

    with TestCase.captureOnCommitCallbacks(execute=True):
        apply_anilist_adult_flags([{"id": anime.anilist_id, "isAdult": True}])

    assert _locs(client.get("/sitemap-anime-1.xml")) == []
