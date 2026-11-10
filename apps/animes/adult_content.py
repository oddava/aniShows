"""The adult-content rule and the denormalized ``Anime.is_adult`` flag (D5).

An anime is adult content when it has an adult genre (by slug) or any of the
explicit tags below. Public surfaces hide it unless the viewer opted in
(``UserProfile.show_adult_content``).

The rule used to run as two ``NOT IN`` subqueries on every public query. It is
now stored on ``Anime.is_adult`` and kept in sync where its inputs change:

- tags: ``Anime.save()`` (and the offline catalog import, which bulk-writes),
- genres: the ``m2m_changed`` receiver on ``Anime.genres`` in ``signals.py``,
  plus the ``Genre`` save/delete receivers for slug renames and deletions,
- provider payloads: ``CatalogProviderBase._prepare_anime_data`` marks a row
  adult when the payload proves it (an adult genre or tag).

``refresh_adult_flags`` recomputes the flag in SQL from the stored genres and
tags; the receivers use it, and it is the reference for the backfill migration.
"""

import json

from django.apps import apps
from django.db import connections
from django.db.models import Exists, OuterRef, Q

ADULT_GENRE_SLUGS = {"erotica", "hentai"}
ADULT_TAGS = {
    "ahegao",
    "anal sex",
    "ashikoki",
    "boobjob",
    "cervix penetration",
    "cumflation",
    "cunnilingus",
    "deepthroat",
    "defloration",
    "double penetration",
    "explicit sex",
    "facial",
    "fellatio",
    "femdom",
    "futanari",
    "group sex",
    "handjob",
    "incest",
    "inseki",
    "irrumatio",
    "lactation",
    "masturbation",
    "mating press",
    "nakadashi",
    "netorare",
    "netorase",
    "netori",
    "nsfw",
    "oyakodon",
    "prostitution",
    "public sex",
    "rape",
    "rimjob",
    "sex",
    "sex toys",
    "succubus",
    "squirting",
    "sumata",
    "threesome",
}


def tags_are_adult(tags) -> bool:
    """Python twin of Postgres ``tags ?| ADULT_TAGS`` (exact, case-sensitive).

    ``?|`` matches string elements of an array, keys of an object, or a bare
    string; anything else (numbers, nested values, null) never matches.
    """
    if isinstance(tags, str):
        return tags in ADULT_TAGS
    if isinstance(tags, dict):
        return any(key in ADULT_TAGS for key in tags)
    if isinstance(tags, list):
        return any(isinstance(tag, str) and tag in ADULT_TAGS for tag in tags)
    return False


def is_adult_content(genre_slugs, tags) -> bool:
    """The adult rule for one anime, given its genre slugs and its tags."""
    return any(slug in ADULT_GENRE_SLUGS for slug in genre_slugs or ()) or tags_are_adult(tags)


def adult_tags_q(database_alias: str = "default") -> Q:
    vendor = connections[database_alias].vendor
    if vendor == "postgresql":
        return Q(tags__has_any_keys=sorted(ADULT_TAGS))

    condition = Q()
    for tag in ADULT_TAGS:
        condition |= Q(tags__icontains=json.dumps(tag))
    return condition


def adult_content_q(database_alias: str = "default") -> Q:
    """The adult rule as a filter on ``Anime`` (what ``is_adult`` must equal)."""
    anime_genres = apps.get_model("anime", "Anime").genres.through
    has_adult_genre = Exists(
        anime_genres.objects.using(database_alias).filter(
            anime_id=OuterRef("pk"), genre__slug__in=ADULT_GENRE_SLUGS
        )
    )
    return Q(has_adult_genre) | adult_tags_q(database_alias)


def refresh_adult_flags(anime_ids, *, using: str = "default") -> int:
    """Recompute ``is_adult`` for these anime from their stored genres and tags.

    Returns how many rows changed.
    """
    ids = {anime_id for anime_id in anime_ids if anime_id}
    if not ids:
        return 0
    rows = apps.get_model("anime", "Anime").objects.using(using).filter(pk__in=ids)
    adult = adult_content_q(using)
    # Two narrow updates, so rows whose flag is already right are not rewritten.
    changed = rows.filter(adult, is_adult=False).update(is_adult=True)
    return changed + rows.exclude(adult).filter(is_adult=True).update(is_adult=False)
