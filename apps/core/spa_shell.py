"""The SPA's index.html with a per-page <head>, for the app's dynamic pages.

Without this every route served the static index.html: one title, one
description and a generic og:url/og:image for every anime and profile link
(RA-001), and the page's largest image was only requested once the app's code
and its API call had run (LCP, RA-002).

Caddy sends ``/anime/*`` and ``/u/*`` here (Caddyfile.prod). The view reads
the deployed index.html (``SPA_INDEX_PATH``, the frontend volume mounted
read-only), swaps the block between the ``route-head`` markers for the page's
own title, description, canonical URL, Open Graph/Twitter tags and JSON-LD,
and adds a high-priority preload for the image that is the page's LCP element,
with the same URLs, srcset and sizes the page's <img> uses so the browser
reuses the preloaded response. The app then renders as before. Anything that
goes wrong answers 503, and Caddy falls back to the static index.html.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from html import escape
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.views import View

from ..shared.logger import logger

HEAD_START = "<!-- route-head:start -->"
HEAD_END = "<!-- route-head:end -->"
SITE_NAME = "AniShows"
# The 1200x630 link-preview card (frontend/public/og-image.png), for pages
# without an image of their own.
DEFAULT_IMAGE_PATH = "/og-image.png"
DEFAULT_IMAGE_ALT = "AniShows: discover, track and talk about anime"
DESCRIPTION_LIMIT = 190


@dataclass(frozen=True)
class ImagePreload:
    """A ``<link rel=preload as=image>`` that matches the page's own <img>."""

    href: str
    srcset: str = ""
    sizes: str = ""


@dataclass
class RouteHead:
    title: str
    description: str
    canonical_path: str
    og_type: str = "website"
    image: str | None = None
    image_alt: str = ""
    large_image: bool = False
    noindex: bool = False
    json_ld: list[dict] = field(default_factory=list)
    preloads: list[ImagePreload] = field(default_factory=list)
    status: int = 200


def site_origin() -> str:
    return str(settings.FRONTEND_URL).rstrip("/")


def absolute_url(value: str | None) -> str | None:
    """An absolute http(s) URL for a media or site path, or None."""
    if not value:
        return None
    value = str(value).strip()
    if not value or value.startswith(("data:", "blob:")):
        return None
    if value.startswith("//"):
        return f"https:{value}"
    if value.startswith(("http://", "https://")):
        return value
    if not value.startswith("/"):
        value = f"/{value}"
    return f"{site_origin()}{value}"


def truncate(value: str, limit: int = DESCRIPTION_LIMIT) -> str:
    value = " ".join(str(value or "").split())
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def _json_ld(data: dict) -> str:
    # "</script>" or "<!--" inside a value must not end or confuse the block.
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def render_head(head: RouteHead) -> str:
    """The tags that replace the static block between the route-head markers."""

    def attr(value: str) -> str:
        return escape(value, quote=True)

    canonical = f"{site_origin()}{head.canonical_path}"
    own_image = absolute_url(head.image)
    image = own_image or absolute_url(DEFAULT_IMAGE_PATH)
    image_alt = head.image_alt if own_image else DEFAULT_IMAGE_ALT
    lines = [
        f"<title>{escape(head.title, quote=False)}</title>",
        f'<meta name="description" content="{attr(head.description)}" />',
    ]
    if head.noindex:
        lines.append('<meta name="robots" content="noindex" />')
    lines += [
        f'<link rel="canonical" href="{attr(canonical)}" />',
        f'<meta property="og:site_name" content="{SITE_NAME}" />',
        f'<meta property="og:type" content="{attr(head.og_type)}" />',
        f'<meta property="og:url" content="{attr(canonical)}" />',
        f'<meta property="og:title" content="{attr(head.title)}" />',
        f'<meta property="og:description" content="{attr(head.description)}" />',
        f'<meta property="og:image" content="{attr(image)}" />',
    ]
    if not own_image:
        lines += [
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
        ]
    if image_alt:
        lines.append(f'<meta property="og:image:alt" content="{attr(image_alt)}" />')
    # Wide images (a banner, the default card) as large cards; covers and avatars small.
    card = "summary_large_image" if head.large_image or not own_image else "summary"
    lines += [
        f'<meta name="twitter:card" content="{card}" />',
        f'<meta name="twitter:title" content="{attr(head.title)}" />',
        f'<meta name="twitter:description" content="{attr(head.description)}" />',
        f'<meta name="twitter:image" content="{attr(image)}" />',
    ]
    for preload in head.preloads:
        parts = [f'<link rel="preload" as="image" href="{attr(preload.href)}"']
        if preload.srcset:
            parts.append(f'imagesrcset="{attr(preload.srcset)}"')
        if preload.sizes:
            parts.append(f'imagesizes="{attr(preload.sizes)}"')
        parts.append('fetchpriority="high" />')
        lines.append(" ".join(parts))
    for data in head.json_ld:
        lines.append(f'<script type="application/ld+json">{_json_ld(data)}</script>')
    return "\n  ".join(lines)


class _IndexFile:
    """The deployed index.html, re-read when the deploy replaces it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._key: tuple[str, int, int] | None = None
        self._parts: tuple[str, str] | None = None

    def parts(self) -> tuple[str, str] | None:
        """(before the head block, after it), or None when unusable."""
        path = str(getattr(settings, "SPA_INDEX_PATH", "") or "")
        if not path:
            return None
        try:
            stat = Path(path).stat()
        except OSError:
            return None
        key = (path, stat.st_mtime_ns, stat.st_size)
        with self._lock:
            if key == self._key:
                return self._parts
        try:
            html = Path(path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            logger.warning("SPA shell: cannot read %s", path, exc_info=True)
            return None
        start = html.find(HEAD_START)
        end = html.find(HEAD_END, start + len(HEAD_START)) if start != -1 else -1
        if start == -1 or end == -1:
            logger.error("SPA shell: %s has no route-head markers", path)
            parts = None
        else:
            parts = (html[: start + len(HEAD_START)], html[end:])
        with self._lock:
            self._key, self._parts = key, parts
        return parts


INDEX_FILE = _IndexFile()


class SpaShellView(View):
    """Serve index.html with the head ``build_head`` returns."""

    http_method_names = ["get", "head"]

    def build_head(self, request, **kwargs) -> RouteHead:
        raise NotImplementedError

    def get(self, request, **kwargs) -> HttpResponse:
        parts = INDEX_FILE.parts()
        if parts is None:
            # Caddy serves the static index.html on a 5xx from here.
            return HttpResponse("SPA shell unavailable", status=503, content_type="text/plain")
        head = self.build_head(request, **kwargs)
        before, after = parts
        html = f"{before}\n  {render_head(head)}\n  {after}"
        response = HttpResponse(html, status=head.status, content_type="text/html; charset=utf-8")
        # Same as the static index.html: always revalidated, so a deploy shows at once.
        response["Cache-Control"] = "public, max-age=0, must-revalidate, no-cache"
        return response
