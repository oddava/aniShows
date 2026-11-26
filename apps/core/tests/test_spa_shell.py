"""The SPA shell: index.html with each page's own <head> (apps/core/spa_shell.py).

RA-001 (per-page meta/Open Graph/JSON-LD) and RA-002 (LCP image preload).
"""

import json
import os
import re
import time
from pathlib import Path

import pytest
from django.test import override_settings

from apps.animes.models import Anime, Genre
from apps.animes.page_head import COVER_SIZES, lcp_preload
from apps.core.spa_shell import HEAD_END, HEAD_START, INDEX_FILE

pytestmark = pytest.mark.django_db

ORIGIN = "https://anishows.example"


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


@pytest.fixture(autouse=True)
def _origin(settings):
    settings.FRONTEND_URL = ORIGIN


def _json_ld(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [json.loads(block) for block in blocks]


def _meta(html: str, prop: str) -> str | None:
    match = re.search(rf'<meta (?:property|name)="{re.escape(prop)}" content="([^"]*)"', html)
    return match.group(1) if match else None


def _frieren(**extra) -> Anime:
    anime = Anime.objects.create(
        title="Frieren: Beyond Journey's End",
        title_jp="葬送のフリーレン",
        slug="frieren",
        synopsis="<p>An elf mage outlives her party.</p>",
        cover_image_external_url="https://cdn.example/cover.jpg",
        banner_image_external_url="https://cdn.example/banner.jpg",
        episode_count=28,
        **extra,
    )
    anime.genres.add(Genre.objects.create(name="Fantasy"))
    return anime


def test_anime_page_has_its_own_head_and_the_app(client):
    _frieren()

    response = client.get("/anime/frieren")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/html")
    html = response.content.decode()
    # The static defaults are gone, the rest of index.html is untouched.
    assert "Static default description." not in html
    assert '<script type="module" crossorigin src="/assets/index-test.js"></script>' in html
    assert '<div id="root"></div>' in html
    assert html.count(HEAD_START) == 1 and html.count(HEAD_END) == 1

    assert "<title>Frieren: Beyond Journey's End (TV) | AniShows</title>" in html
    assert _meta(html, "description") == "An elf mage outlives her party."
    assert _meta(html, "og:url") == f"{ORIGIN}/anime/frieren"
    assert f'<link rel="canonical" href="{ORIGIN}/anime/frieren" />' in html
    assert _meta(html, "og:type") == "video.tv_show"
    assert _meta(html, "og:image") == "https://cdn.example/cover.jpg"
    assert "noindex" not in html

    (data,) = _json_ld(html)
    assert data["@type"] == "TVSeries"
    assert data["name"] == "Frieren: Beyond Journey's End"
    assert data["alternateName"] == "葬送のフリーレン"
    assert data["genre"] == ["Fantasy"]
    assert data["numberOfEpisodes"] == 28
    assert data["url"] == f"{ORIGIN}/anime/frieren"

    # The banner is the LCP element: preloaded with the <img>'s own srcset/sizes.
    assert (
        '<link rel="preload" as="image" href="https://cdn.example/banner.jpg" '
        'imagesrcset="https://cdn.example/banner.jpg 400w" imagesizes="100vw" '
        'fetchpriority="high" />'
    ) in html


def test_tabs_share_the_canonical_page(client):
    _frieren()

    html = client.get("/anime/frieren/characters").content.decode()

    assert _meta(html, "og:url") == f"{ORIGIN}/anime/frieren"


def test_adult_titles_say_nothing_about_themselves(client):
    _frieren(is_adult=True)

    response = client.get("/anime/frieren")

    assert response.status_code == 200
    html = response.content.decode()
    assert "Frieren" not in html.split(HEAD_END)[0].split(HEAD_START)[1]
    assert '<meta name="robots" content="noindex" />' in html
    assert 'rel="preload"' not in html
    assert _json_ld(html) == []


def test_missing_anime_is_a_404_page_the_app_still_renders(client):
    response = client.get("/anime/nope")

    assert response.status_code == 404
    html = response.content.decode()
    assert "Anime not found" in html
    assert '<div id="root"></div>' in html
    assert "noindex" in html


def test_hostile_text_is_escaped(client):
    Anime.objects.create(
        title='Evil"><script>alert(1)</script>',
        slug="evil",
        synopsis="</script><script>alert(2)</script>",
    )

    html = client.get("/anime/evil").content.decode()

    assert "<script>alert" not in html
    (data,) = _json_ld(html)
    assert data["name"] == 'Evil"><script>alert(1)</script>'


def test_cover_preload_without_a_banner():
    images = {
        "cover_image": "/media/anime/covers/x.jpg",
        "cover_image_small": "/media/CACHE/x-small.webp",
        "cover_image_medium": "/media/CACHE/x-medium.webp",
        "cover_image_large": "/media/CACHE/x-large.webp",
        "banner_image": None,
        "banner_image_large": "null",
    }

    preload = lcp_preload(images)

    assert preload.href == "/media/CACHE/x-large.webp"
    assert preload.srcset == (
        "/media/CACHE/x-small.webp 150w, /media/CACHE/x-medium.webp 230w, "
        "/media/CACHE/x-large.webp 300w"
    )
    assert preload.sizes == COVER_SIZES


def test_banner_preload_offers_the_original_too():
    images = {
        "banner_image": "/media/anime/banners/b.jpg",
        "banner_image_small": "/media/CACHE/b-small.webp",
        "banner_image_medium": "/media/CACHE/b-medium.webp",
        "banner_image_large": "/media/CACHE/b-large.webp",
    }

    preload = lcp_preload(images)

    assert preload.href == "/media/CACHE/b-large.webp"
    assert preload.srcset.endswith("/media/anime/banners/b.jpg 1900w")
    assert preload.sizes == "100vw"


def test_the_head_is_cached_per_title(client, django_assert_max_num_queries):
    _frieren()
    client.get("/anime/frieren")

    with django_assert_max_num_queries(1):
        # Only the catalog namespace may be read; no anime query.
        response = client.get("/anime/frieren")
    assert response.status_code == 200


def test_no_index_file_answers_503_for_caddy_to_fall_back(client, settings):
    _frieren()
    settings.SPA_INDEX_PATH = "/nonexistent/index.html"

    response = client.get("/anime/frieren")

    assert response.status_code == 503


def test_a_new_deploy_is_picked_up(client, settings, tmp_path: Path):
    index = tmp_path / "index.html"
    index.write_text(f"<head>{HEAD_START}{HEAD_END}</head><body>v1</body>", encoding="utf-8")
    settings.SPA_INDEX_PATH = str(index)
    assert "v1" in client.get("/anime/nope").content.decode()

    index.write_text(f"<head>{HEAD_START}{HEAD_END}</head><body>v2!</body>", encoding="utf-8")
    later = time.time() + 5
    os.utime(index, (later, later))

    assert "v2!" in client.get("/anime/nope").content.decode()


def test_an_index_without_markers_is_not_served(client, settings, tmp_path: Path):
    index = tmp_path / "index.html"
    index.write_text("<head></head><body></body>", encoding="utf-8")
    settings.SPA_INDEX_PATH = str(index)

    assert client.get("/anime/nope").status_code == 503
    INDEX_FILE._key = None


@override_settings(FRONTEND_URL=ORIGIN)
def test_html_is_revalidated_like_the_static_index(client):
    response = client.get("/anime/nope")

    assert response["Cache-Control"] == "public, max-age=0, must-revalidate, no-cache"
