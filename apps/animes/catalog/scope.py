"""What the catalog holds: Japanese animation, without music videos.

Adult titles are in scope; the adult gate (``adult_content``) hides them. The rule is
applied in two places: inside the AniList queries (so no request is spent on titles
that would be thrown away) and to stored rows (``rescope_stored``), which keeps an
out-of-scope row reachable by link but out of every public listing.
"""

from __future__ import annotations

from collections import defaultdict

from django.conf import settings

# Reasons this module owns. Any other reason on a row (an admin's, a legacy one) is
# never cleared or overwritten by the rule.
SCOPE_REASON_PREFIXES = ("country:", "format:")


def countries() -> list[str]:
    return [code.upper() for code in getattr(settings, "CATALOG_COUNTRIES", ["JP"])]


def excluded_formats() -> list[str]:
    return [fmt.upper() for fmt in getattr(settings, "CATALOG_EXCLUDED_FORMATS", ["MUSIC"])]


# GraphQL pieces for a scoped ``Page.media`` query.
VARIABLE_DEFINITIONS = "$countries: [CountryCode], $excludedFormats: [MediaFormat]"
ARGUMENTS = "countryOfOrigin_in: $countries, format_not_in: $excludedFormats"


def query_variables() -> dict[str, list[str]]:
    return {"countries": countries(), "excludedFormats": excluded_formats()}


def exclusion_reason(country: str | None, media_format: str | None) -> str:
    """Why a title with this origin and format is outside the scope; "" when it is in.

    An unknown origin or format is in scope: a row is only hidden for a fact, never
    for a gap in the data.
    """
    country = (country or "").upper()
    media_format = (media_format or "").upper()
    if country and country not in countries():
        return f"country:{country}"
    if media_format and media_format in excluded_formats():
        return f"format:{media_format}"
    return ""


def media_exclusion_reason(media: dict) -> str:
    media_type = media.get("type")
    if media_type and media_type != "ANIME":
        return f"type:{media_type}"[:32]
    return exclusion_reason(media.get("countryOfOrigin"), media.get("format"))


def is_scope_reason(reason: str) -> bool:
    return not reason or reason.startswith(SCOPE_REASON_PREFIXES)


def rescope_stored() -> dict[str, int]:
    """Re-apply the rule to every stored row, from its stored origin and format (no requests).

    Returns ``{"hidden": n, "shown": n}``. Rows with a reason the rule does not own
    are left alone.
    """
    from ..models import Anime

    moves: dict[str, list[int]] = defaultdict(list)
    rows = Anime.objects.values_list(
        "id", "country_of_origin", "anilist_format", "catalog_excluded"
    )
    for anime_id, country, media_format, current in rows.iterator(chunk_size=2000):
        if not is_scope_reason(current):
            continue
        wanted = exclusion_reason(country, media_format)
        if wanted != current:
            moves[wanted].append(anime_id)

    hidden = shown = 0
    for reason, ids in moves.items():
        for start in range(0, len(ids), 1000):
            changed = Anime.objects.filter(id__in=ids[start : start + 1000]).update(
                catalog_excluded=reason
            )
            if reason:
                hidden += changed
            else:
                shown += changed
    if hidden or shown:
        from ..services.public_anime_service import AnimePublicPayloadService

        AnimePublicPayloadService.bump_collection_cache_namespace()
    return {"hidden": hidden, "shown": shown}
