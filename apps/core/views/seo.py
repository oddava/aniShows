"""robots.txt and the XML sitemap, served by Django so they list the live catalog.

Caddy routes ``/robots.txt`` and ``/sitemap*.xml`` here (Caddyfile.prod); the
SPA serves every other path. URLs are absolute on ``FRONTEND_URL``, the public
origin. The sitemap is an index (``/sitemap.xml``) of one static-pages file and
anime files of ``ANIME_PER_FILE`` URLs each (the protocol allows 50,000), so it
keeps working as the catalog grows. Adult titles (AniList ``isAdult``) and
quarantined rows are left out: they are not public pages. Each file is cached
under the catalog's collection namespace, so visibility changes drop it at once.
"""

from xml.sax.saxutils import escape

from django.conf import settings
from django.http import Http404, HttpResponse
from django.views.decorators.http import require_GET

from ...animes.models import Anime
from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ...shared.public_cache import best_effort_get, best_effort_set

ANIME_PER_FILE = 10_000
CACHE_TTL_SECONDS = 6 * 60 * 60
CACHE_PREFIX = "seo:v1:"
STATIC_PATHS = ("/", "/browse", "/seasonal", "/schedule", "/forums", "/privacy")
# Account, settings and token pages: nothing for a crawler (they are noindex too).
DISALLOWED_PATHS = (
    "/admin",
    "/settings",
    "/import",
    "/export",
    "/notifications",
    "/auth/",
    "/login",
    "/register",
    "/forgot-password",
    "/verify-email/",
    "/confirm-email-change/",
    "/reset-password/",
    "/verification-pending",
)


def _origin() -> str:
    return str(settings.FRONTEND_URL).rstrip("/")


def _cached(key: str, build) -> str:
    """``build()``, cached under the catalog's collection namespace.

    Every change to what is public (an anime saved, flagged adult, quarantined)
    bumps that namespace, so a title hidden since stops being advertised at once.
    """
    from ...animes.services.public_anime_service import AnimePublicPayloadService

    try:
        namespace = AnimePublicPayloadService.collection_cache_namespace()
    except CACHE_ERRORS:
        logger.warning("SEO cache unavailable (read)", exc_info=True)
        return build()
    # best_effort_*: a cache error is a miss, and a key built while the
    # namespace was unavailable (an outage key) is never read or written.
    cache_key = f"{CACHE_PREFIX}{namespace}:{key}"
    body = best_effort_get(cache_key, source="SEO")
    if body is None:
        body = build()
        best_effort_set(cache_key, body, CACHE_TTL_SECONDS, source="SEO")
    return body


def _public_anime():
    return Anime.public_queryset().filter(is_adult=False).order_by("pk")


def _anime_file_count() -> int:
    return max(1, -(-_public_anime().count() // ANIME_PER_FILE))


def _xml(response_body: str) -> HttpResponse:
    response = HttpResponse(response_body, content_type="application/xml; charset=utf-8")
    response["Cache-Control"] = "public, max-age=3600"
    return response


@require_GET
def robots_txt(request):
    lines = ["User-agent: *", "Allow: /"]
    lines += [f"Disallow: {path}" for path in DISALLOWED_PATHS]
    lines += ["", f"Sitemap: {_origin()}/sitemap.xml", ""]
    response = HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "public, max-age=3600"
    return response


@require_GET
def sitemap_index(request):
    def build() -> str:
        origin = _origin()
        files = ["sitemap-pages.xml"] + [
            f"sitemap-anime-{number}.xml" for number in range(1, _anime_file_count() + 1)
        ]
        entries = "".join(
            f"<sitemap><loc>{escape(f'{origin}/{name}')}</loc></sitemap>" for name in files
        )
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</sitemapindex>'
        )

    return _xml(_cached("index", build))


def _urlset(entries: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    )


@require_GET
def sitemap_pages(request):
    def build() -> str:
        origin = _origin()
        return _urlset(
            "".join(f"<url><loc>{escape(origin + path)}</loc></url>" for path in STATIC_PATHS)
        )

    return _xml(_cached("pages", build))


@require_GET
def sitemap_anime(request, number: int):
    if number < 1 or number > _anime_file_count():
        raise Http404("No such sitemap file")

    def build() -> str:
        origin = _origin()
        start = (number - 1) * ANIME_PER_FILE
        rows = _public_anime().values_list("slug", "updated_at")[start : start + ANIME_PER_FILE]
        entries = []
        for slug, updated_at in rows:
            lastmod = f"<lastmod>{updated_at.date().isoformat()}</lastmod>" if updated_at else ""
            entries.append(f"<url><loc>{escape(f'{origin}/anime/{slug}')}</loc>{lastmod}</url>")
        return _urlset("".join(entries))

    return _xml(_cached(f"anime:{number}", build))
