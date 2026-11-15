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

Writes that skip ``save()`` and the m2m signal (``QuerySet.update(tags=...)``,
``bulk_update`` with ``tags``, a through-model ``bulk_create``) must call
``refresh_adult_flags`` themselves; ``test_adult_flag_writers.py`` fails when a
new one appears. ``reconcile_adult_flags`` is the nightly safety net: it fixes
any drift over the whole table and logs a warning when it finds some.
"""

import json

from django.apps import apps
from django.db import connections
from django.db.models import Exists, OuterRef, Q

from ..shared.logger import logger

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
    flagged, cleared = _sync_flags(rows, using)
    return flagged + cleared


def reconcile_adult_flags(*, using: str = "default") -> dict:
    """Fix ``is_adult`` drift across the whole catalog (the nightly safety net).

    Drift means some write changed genres or tags without refreshing the flag.
    A row wrongly marked not-adult is shown to anonymous visitors, so drift is
    logged as a warning to make the writer that caused it findable.
    """
    rows = apps.get_model("anime", "Anime").objects.using(using)
    flagged, cleared = _sync_flags(rows, using)
    if flagged or cleared:
        logger.warning(
            "Adult flag drift fixed: %s rows newly flagged adult, %s rows cleared",
            flagged,
            cleared,
        )
    return {"flagged": flagged, "cleared": cleared}


def _sync_flags(rows, using: str) -> tuple[int, int]:
    """Set ``is_adult`` where it is wrong; returns (newly flagged, newly cleared).

    ``update()`` skips the save signals, so the changed rows' cached public
    payloads are dropped here: an adult title must not linger in a cached
    anonymous list or detail page.
    """
    adult = adult_content_q(using)
    to_flag = dict(rows.filter(adult, is_adult=False).values_list("pk", "slug"))
    to_clear = dict(rows.exclude(adult).filter(is_adult=True).values_list("pk", "slug"))
    # Narrow updates, so rows whose flag is already right are not rewritten.
    flagged = rows.filter(adult, is_adult=False, pk__in=to_flag).update(is_adult=True)
    cleared = rows.exclude(adult).filter(is_adult=True, pk__in=to_clear).update(is_adult=False)
    if flagged or cleared:
        _invalidate_public_caches([*to_flag.values(), *to_clear.values()])
    return flagged, cleared


def _invalidate_public_caches(slugs: list[str]) -> None:
    from .signals import _invalidate_anime_public_caches  # signals imports this module

    for slug in slugs:
        _invalidate_anime_public_caches(slug)
