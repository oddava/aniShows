"""Pure AniList normalization: payload dicts in, plain values and dicts out.

Nothing here does I/O or touches the database.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse, urlunparse

from .....shared.logger import logger

if TYPE_CHECKING:
    from collections.abc import Callable

TRUSTED_IMAGE_DOMAINS = (
    "s4.anilist.co",
    "anilist.co",
    "img.anilist.co",
    "cdn.myanimelist.net",
    "api-cdn.myanimelist.net",
)
MAL_IMAGE_PROXY_DOMAINS = ("myanimelist.net", "www.myanimelist.net")
IMAGE_FILE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
MAX_INT_32 = 2_147_483_647


def is_valid_id(value) -> bool:
    """A positive 32-bit int, as AniList and MAL IDs are."""
    return isinstance(value, int) and 0 < value <= MAX_INT_32


def is_trusted_image_domain(domain: str, trusted_domains=TRUSTED_IMAGE_DOMAINS) -> bool:
    return any(domain.endswith(trusted) or domain == trusted for trusted in trusted_domains)


def normalize_external_image_url(
    url: str | None,
    *,
    proxy_domains=MAL_IMAGE_PROXY_DOMAINS,
    image_extensions=IMAGE_FILE_EXTENSIONS,
) -> str:
    """Normalize external image URLs while preserving display-safe fallbacks."""
    candidate = (url or "").strip()
    if not candidate:
        return ""

    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        logger.warning(f"Blocked malformed image URL: {candidate}")
        return ""

    domain = parsed.netloc.lower()
    path = parsed.path or ""
    if domain in proxy_domains:
        lower_path = path.lower()
        if "/images/" in lower_path or lower_path.endswith(image_extensions):
            parsed = parsed._replace(scheme="https", netloc="cdn.myanimelist.net")
            return urlunparse(parsed)

    if parsed.scheme != "https":
        parsed = parsed._replace(scheme="https")
        return urlunparse(parsed)

    return candidate


def resolve_fetchable_image_url(
    normalized: str,
    *,
    trusted_domains=TRUSTED_IMAGE_DOMAINS,
) -> str:
    """Return ``normalized`` if it points at a trusted image host, else ""."""
    if not normalized:
        return ""

    parsed = urlparse(normalized)
    domain = parsed.netloc.lower()
    if is_trusted_image_domain(domain, trusted_domains):
        return normalized

    logger.info(f"Blocked untrusted image domain before fetch queue: {domain}")
    return ""


def parse_graphql_error_code(message: str) -> str:
    lowered = (message or "").lower()
    if "too many requests" in lowered or "rate limit" in lowered:
        return "rate_limited"
    if "variable" in lowered and any(
        token in lowered for token in ("invalid", "expected", "cannot represent")
    ):
        return "invalid_variable"
    if "not found" in lowered or "no such" in lowered:
        return "not_found"
    return "transport_error"


def search_variants(primary: str) -> list[str]:
    """The sanitized query, plus a punctuation-free variant when it differs."""
    if not primary:
        return []

    variants = [primary]
    simplified = re.sub(r"[^0-9A-Za-zÀ-ɏЀ-ӿ぀-ヿ一-鿿\s]", " ", primary)
    simplified = re.sub(r"\s+", " ", simplified).strip()
    if simplified and simplified not in variants:
        variants.append(simplified[:120])

    return variants


def media_titles(item: dict) -> tuple[str, str]:
    """(display title, native title): English first, then romaji."""
    title_romaji = item.get("title", {}).get("romaji", "")
    title_english = item.get("title", {}).get("english", "")
    title_native = item.get("title", {}).get("native", "")
    return title_english or title_romaji, title_native


def parse_theme_song(text: str) -> dict:
    """Parse AniList theme song format: 'Song Title' by Artist (eps X-Y)"""
    result = {"title": text, "artist": "", "episodes": ""}

    if not text:
        return result

    # Try to extract episode range (eps X-Y)
    episode_match = re.search(r"\s*\(eps?\s*([\d\-\s,]+)\)\s*$", text, re.IGNORECASE)
    if episode_match:
        result["episodes"] = episode_match.group(1).strip()
        text = text[: episode_match.start()].strip()

    # Try to extract artist: look for ' by ' pattern
    # Handle quoted titles: "Song Title" by Artist
    if text.startswith('"') and '" by ' in text:
        parts = text.split('" by ', 1)
        if len(parts) == 2:
            result["title"] = parts[0][1:].strip()  # Remove opening quote
            result["artist"] = parts[1].strip()
    elif text.startswith("'") and "' by " in text:
        parts = text.split("' by ", 1)
        if len(parts) == 2:
            result["title"] = parts[0][1:].strip()  # Remove opening quote
            result["artist"] = parts[1].strip()
    elif " by " in text:
        # Simple format: Song Title by Artist
        parts = text.rsplit(" by ", 1)
        if len(parts) == 2:
            result["title"] = parts[0].strip()
            result["artist"] = parts[1].strip()
    else:
        result["title"] = text.strip()

    return result


def trailer_url(trailer: dict | None) -> str | None:
    """Watch URL for a YouTube or Dailymotion trailer, else None."""
    if not trailer:
        return None
    trailer_id = trailer.get("id")
    trailer_site = trailer.get("site")
    if not (trailer_id and trailer_site):
        return None
    if trailer_site.lower() == "youtube":
        return f"https://www.youtube.com/watch?v={trailer_id}"
    if trailer_site.lower() == "dailymotion":
        return f"https://www.dailymotion.com/video/{trailer_id}"
    return None


def cover_image(item: dict) -> dict:
    cover = item.get("coverImage") or {}
    return cover if isinstance(cover, dict) else {}


def character_fields(node: dict) -> dict:
    """Character row values from a ``characterPreview`` edge node."""
    return {
        "anilist_id": node.get("id"),
        "name": node["name"].get("full"),
        "name_native": node["name"].get("native"),
        "description": node.get("description") or "",
        "image_url": node.get("image", {}).get("large"),
    }


def person_fields(node: dict) -> dict:
    """Staff row values from a voice actor or ``staffPreview`` edge node."""
    return {
        "anilist_id": node.get("id"),
        "name": node["name"].get("full"),
        "name_native": node["name"].get("native"),
        "image_url": node.get("image", {}).get("large"),
        "description": node.get("description") or "",
    }


def character_edges(item: dict) -> list[dict]:
    return (item.get("characterPreview") or {}).get("edges") or []


def staff_edges(item: dict) -> list[dict]:
    return (item.get("staffPreview") or {}).get("edges") or []


def studio_names(item: dict) -> list[str]:
    names = [node.get("name") for node in (item.get("studios") or {}).get("nodes") or []]
    return [name for name in names if name]


def map_recommendations(
    data: dict, normalize_image: Callable[[str | None], str] = normalize_external_image_url
) -> list[dict]:
    """Flatten a ``Media.recommendations`` response, dropping repeats and junk nodes."""
    recommendation_nodes = ((data.get("Media") or {}).get("recommendations") or {}).get(
        "nodes"
    ) or []
    if not isinstance(recommendation_nodes, list):
        return []

    recommendations: list[dict] = []
    seen_ids: set[int] = set()

    for recommendation in recommendation_nodes:
        if not isinstance(recommendation, dict):
            continue

        media = recommendation.get("mediaRecommendation") or {}
        if not isinstance(media, dict):
            continue

        recommendation_id = media.get("id")
        if not recommendation_id or recommendation_id in seen_ids:
            continue

        seen_ids.add(recommendation_id)
        title = media.get("title") or {}
        cover = media.get("coverImage") or {}
        average_score = media.get("averageScore")

        recommendations.append(
            {
                "id": recommendation_id,
                "mal_id": media.get("idMal"),
                "title": title.get("english") or title.get("romaji") or title.get("native"),
                "title_jp": title.get("native") or "",
                "format": media.get("format"),
                "status": media.get("status"),
                "episode_count": media.get("episodes") or 0,
                "member_count": media.get("popularity") or 0,
                "rating": round(average_score / 10, 1) if average_score else None,
                "cover_image_external_url": normalize_image(
                    cover.get("extraLarge") or cover.get("large")
                ),
                "recommendation_rating": recommendation.get("rating"),
            }
        )

    return recommendations


def titles_casefolded(candidate: dict) -> set[str]:
    titles = candidate.get("title", {})
    return {
        (titles.get("english") or "").casefold(),
        (titles.get("romaji") or "").casefold(),
        (titles.get("native") or "").casefold(),
    }
