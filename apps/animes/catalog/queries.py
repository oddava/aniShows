"""The GraphQL the lanes send. Lean pages of 50; full payloads (cast, staff) of 25."""

from __future__ import annotations

from ..services.providers.anilist.client import MEDIA_FIELDS
from . import scope

PAGE_SIZE = 50
FULL_PAGE_SIZE = 25
# AniList refuses to page past 5,000 results ("Page depth exceeds maximum").
MAX_PAGES = 5000 // PAGE_SIZE

# Everything a card, a shelf, a filter, the schedule and franchise links need.
# Cast, staff, stats and links come with the full payload (``hydrate``).
LEAN_FIELDS = """
    id idMal type
    title { romaji english native }
    synonyms
    format status episodes duration averageScore popularity isAdult countryOfOrigin updatedAt
    startDate { year month day }
    endDate { year month day }
    season seasonYear source
    genres
    tags { name rank isGeneralSpoiler isMediaSpoiler }
    studios(isMain: true) { nodes { name } }
    description
    coverImage { large extraLarge }
    bannerImage
    trailer { id site }
    rankings { rank type allTime context }
    nextAiringEpisode { episode airingAt }
    relations {
        edges {
            relationType
            node { id idMal title { romaji english native } type format status coverImage { large } }
        }
    }
"""

# ``MEDIA_FIELDS`` already carries type, countryOfOrigin and updatedAt.
FULL_FIELDS = MEDIA_FIELDS

_PAGE_INFO = "pageInfo { hasNextPage }"


def season_page() -> str:
    return f"""
    query CatalogSeason($season: MediaSeason, $year: Int, $page: Int, $perPage: Int,
                        {scope.VARIABLE_DEFINITIONS}) {{
        Page(page: $page, perPage: $perPage) {{
            {_PAGE_INFO}
            media(type: ANIME, season: $season, seasonYear: $year, sort: [POPULARITY_DESC, ID],
                  {scope.ARGUMENTS}) {{ {LEAN_FIELDS} }}
        }}
    }}
    """


def year_page() -> str:
    """One release year (``startDate`` between two FuzzyDateInts), in ID order."""
    return f"""
    query CatalogSweepYear($after: FuzzyDateInt, $before: FuzzyDateInt, $page: Int,
                           $perPage: Int, {scope.VARIABLE_DEFINITIONS}) {{
        Page(page: $page, perPage: $perPage) {{
            {_PAGE_INFO}
            media(type: ANIME, startDate_greater: $after, startDate_lesser: $before, sort: [ID],
                  {scope.ARGUMENTS}) {{ {LEAN_FIELDS} }}
        }}
    }}
    """


def unreleased_page() -> str:
    """Announced titles, most of which have no start date yet (so no year window has them)."""
    return f"""
    query CatalogSweepUnreleased($page: Int, $perPage: Int, {scope.VARIABLE_DEFINITIONS}) {{
        Page(page: $page, perPage: $perPage) {{
            {_PAGE_INFO}
            media(type: ANIME, status: NOT_YET_RELEASED, sort: [POPULARITY_DESC, ID],
                  {scope.ARGUMENTS}) {{ {LEAN_FIELDS} }}
        }}
    }}
    """


# Unscoped on purpose: a title whose origin or format AniList corrects shows up here
# too, so a stored row can be hidden (or shown again) by the change.
CHANGES_PAGE = f"""
query CatalogChanges($page: Int, $perPage: Int) {{
    Page(page: $page, perPage: $perPage) {{
        {_PAGE_INFO}
        media(type: ANIME, sort: [UPDATED_AT_DESC]) {{ {LEAN_FIELDS} }}
    }}
}}
"""


def trending_page() -> str:
    return f"""
    query CatalogTrending($page: Int, $perPage: Int, {scope.VARIABLE_DEFINITIONS}) {{
        Page(page: $page, perPage: $perPage) {{
            {_PAGE_INFO}
            media(type: ANIME, sort: [TRENDING_DESC], {scope.ARGUMENTS}) {{ {LEAN_FIELDS} }}
        }}
    }}
    """


def by_ids(argument: str, *, full: bool) -> str:
    """Media by ``id_in`` or ``idMal_in``; unscoped, so stored rows learn their origin."""
    fields = FULL_FIELDS if full else LEAN_FIELDS
    name = "CatalogFullByIds" if full else "CatalogLeanByIds"
    return f"""
    query {name}($ids: [Int], $perPage: Int) {{
        Page(page: 1, perPage: $perPage) {{
            media({argument}: $ids, type: ANIME) {{ {fields} }}
        }}
    }}
    """
