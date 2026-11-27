"""The <head> of an anime's page (/anime/<slug>), for the SPA shell (RA-001, RA-002).

The preload mirrors pages/AnimeDetail.jsx and utils/imageUtils.js exactly: a
show with a banner preloads the banner (src = large variant, srcset of the
400/800/1200 variants and the 1900px original, sizes 100vw); a show without one
preloads its cover with the sizes of the cover <img> shown at each width
(TitleSection below lg, PosterColumn from lg). The URLs come from the API's own
serializer, so they are the strings the page renders.
"""

from html import unescape
from urllib.parse import quote

from django.utils.html import strip_tags

from ..core.spa_shell import ImagePreload, RouteHead, SpaShellView, absolute_url, truncate
from ..shared.errors import CACHE_ERRORS
from ..shared.logger import logger
from ..shared.public_cache import best_effort_get, best_effort_set
from .models import Anime
from .serializers.anime import AnimeDetailSerializer

CACHE_TTL_SECONDS = 10 * 60
CACHE_PREFIX = "spa-head:anime:v1:"
BANNER_WIDTHS = (("small", 400), ("medium", 800), ("large", 1200))
BANNER_ORIGINAL_WIDTH = 1900
COVER_WIDTHS = (("small", 150), ("medium", 230), ("large", 300))
BANNER_SIZES = "100vw"
COVER_SIZES = "(min-width: 1024px) 280px, (min-width: 768px) 144px, 104px"
SCHEMA_TYPES = {Anime.AnimeType.movie: "Movie"}


def _blank(value) -> bool:
    return not isinstance(value, str) or value.strip().lower() in ("", "null", "undefined")


def _clean(value):
    return None if _blank(value) else value.strip()


def image_urls(anime: Anime) -> dict:
    """The image fields of the detail API payload, from its own serializer."""
    serializer = AnimeDetailSerializer(context={})
    return {
        "cover_image": serializer.get_cover_image(anime),
        "cover_image_small": serializer.get_cover_image_small(anime),
        "cover_image_medium": serializer.get_cover_image_medium(anime),
        "cover_image_large": serializer.get_cover_image_large(anime),
        "cover_image_external_url": anime.cover_image_external_url,
        "banner_image": serializer.get_banner_image(anime),
        "banner_image_small": serializer.get_banner_image_small(anime),
        "banner_image_medium": serializer.get_banner_image_medium(anime),
        "banner_image_large": serializer.get_banner_image_large(anime),
        "banner_image_external_url": anime.banner_image_external_url,
    }


def _srcset(candidates) -> str:
    """getImageSrcSet: blanks skipped, the first of equal URLs kept."""
    seen: set[str] = set()
    entries = []
    for url, width in candidates:
        url = _clean(url)
        if not url or url in seen:
            continue
        seen.add(url)
        entries.append(f"{url} {width}w")
    return ", ".join(entries)


def lcp_preload(images: dict) -> ImagePreload | None:
    has_banner = any(
        _clean(images.get(key))
        for key in (
            "banner_image_large",
            "banner_image_medium",
            "banner_image",
            "banner_image_external_url",
        )
    )
    if has_banner:
        href = (
            _clean(images.get("banner_image_large"))
            or _clean(images.get("banner_image"))
            or (_clean(images.get("banner_image_external_url")))
        )
        candidates = [(images.get(f"banner_image_{size}"), width) for size, width in BANNER_WIDTHS]
        original = _clean(images.get("banner_image")) or _clean(
            images.get("banner_image_external_url")
        )
        if original:
            candidates.append((original, BANNER_ORIGINAL_WIDTH))
        return ImagePreload(href=href, srcset=_srcset(candidates), sizes=BANNER_SIZES)

    href = (
        _clean(images.get("cover_image_large"))
        or _clean(images.get("cover_image"))
        or _clean(images.get("cover_image_external_url"))
    )
    if not href:
        return None
    candidates = [(images.get(f"cover_image_{size}"), width) for size, width in COVER_WIDTHS]
    return ImagePreload(href=href, srcset=_srcset(candidates), sizes=COVER_SIZES)


def _plain(value: str | None) -> str:
    return " ".join(strip_tags(unescape(value or "")).split())


def build_anime_head(anime: Anime) -> RouteHead:
    canonical_path = f"/anime/{quote(anime.slug)}"
    if anime.is_adult:
        # Only viewers who opted in see the page; nothing about it goes out here.
        return RouteHead(
            title="Adult content | AniShows",
            description="This title is marked 18+ and is only shown to members who opted in.",
            canonical_path=canonical_path,
            noindex=True,
        )

    images = image_urls(anime)
    cover = (
        _clean(images["cover_image_large"])
        or _clean(images["cover_image"])
        or _clean(images["cover_image_external_url"])
    )
    synopsis = _plain(anime.synopsis)
    year = anime.release_date.year if anime.release_date else None
    # The stored value ("TV", "OVA", "Movie"): the labels are generated ("Tv").
    kind = anime.anime_type if anime.anime_type != Anime.AnimeType.unknown else ""
    facts = ", ".join(str(part) for part in (kind, year) if part)
    title = f"{anime.title} ({facts}) | AniShows" if facts else f"{anime.title} | AniShows"
    description = truncate(
        synopsis or f"{anime.title} on AniShows: episodes, characters, reviews and where to watch."
    )
    genres = [genre.name for genre in anime.genres.all()]

    data = {
        "@context": "https://schema.org",
        "@type": SCHEMA_TYPES.get(anime.anime_type, "TVSeries"),
        "name": anime.title,
        "url": absolute_url(canonical_path),
    }
    if anime.title_jp and anime.title_jp != anime.title:
        data["alternateName"] = anime.title_jp
    if synopsis:
        data["description"] = truncate(synopsis, 500)
    if cover and absolute_url(cover):
        data["image"] = absolute_url(cover)
    if genres:
        data["genre"] = genres
    if anime.release_date:
        key = "datePublished" if anime.anime_type == Anime.AnimeType.movie else "startDate"
        data[key] = anime.release_date.isoformat()
    if anime.anime_type != Anime.AnimeType.movie and anime.episode_count:
        data["numberOfEpisodes"] = anime.episode_count

    preload = lcp_preload(images)
    return RouteHead(
        title=title,
        description=description,
        canonical_path=canonical_path,
        og_type="video.movie" if anime.anime_type == Anime.AnimeType.movie else "video.tv_show",
        image=cover,
        image_alt=anime.title,
        large_image=False,
        json_ld=[data],
        preloads=[preload] if preload else [],
    )


def _not_found(slug: str) -> RouteHead:
    return RouteHead(
        title="Anime not found | AniShows",
        description="This anime could not be found on AniShows.",
        canonical_path=f"/anime/{quote(slug)}",
        noindex=True,
        status=404,
    )


def _namespace() -> str | None:
    from .services.public_anime_service import AnimePublicPayloadService

    try:
        return AnimePublicPayloadService.collection_cache_namespace()
    except CACHE_ERRORS:
        return None


class AnimeShellView(SpaShellView):
    def build_head(self, request, slug: str, **kwargs) -> RouteHead:
        namespace = _namespace()
        key = f"{CACHE_PREFIX}{namespace}:{slug}" if namespace is not None else None
        if key and len(key) <= 240:
            cached = best_effort_get(key, source="spa anime head")
            if isinstance(cached, RouteHead):
                return cached
        else:
            key = None

        anime = (
            Anime.public_queryset()
            .filter(slug=slug)
            .prefetch_related("genres")
            .only(
                "id",
                "slug",
                "title",
                "title_jp",
                "synopsis",
                "anime_type",
                "is_adult",
                "release_date",
                "episode_count",
                "cover_image",
                "cover_image_external_url",
                "banner_image",
                "banner_image_external_url",
            )
            .first()
        )
        if anime is None:
            head = _not_found(slug)
        else:
            try:
                head = build_anime_head(anime)
            except Exception:  # noqa: BLE001 - storage/ImageKit fail in backend-specific ways
                # A broken image or storage error must not take the page down.
                logger.warning("SPA shell: anime head failed for %s", slug, exc_info=True)
                head = RouteHead(
                    title=f"{anime.title} | AniShows",
                    description=truncate(_plain(anime.synopsis)) or "Anime on AniShows.",
                    canonical_path=f"/anime/{quote(anime.slug)}",
                )
        if key:
            best_effort_set(key, head, CACHE_TTL_SECONDS, source="spa anime head")
        return head
