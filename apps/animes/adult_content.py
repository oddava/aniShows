"""The adult-content rule: ``Anime.is_adult`` is AniList's ``Media.isAdult`` (owner decision).

An anime is adult content exactly when AniList says so. Genres and tags play no
part: thematic tags ("prostitution", "incest", ...) flagged mainstream shows
such as *The Apothecary Diaries* under the old genre/tag rule. Public lists,
search, shelves and recommendations hide adult rows unless the viewer opted in
(``UserProfile.show_adult_content``); a direct link to one shows an opt-in gate
(``views/anime.py``), not a 404.

Where the flag comes from:

- every full AniList payload (``MEDIA_FIELDS``) and every airing payload
  (``AIRING_FIELDS``) carries ``isAdult``; ``CatalogProviderBase._prepare_anime_data``
  stores it on create and update (``anilist_is_adult``);
- ``sync_adult_flags_from_anilist`` (weekly task, and ``manage.py sync_adult_flags``
  after a deploy) re-reads it for the whole catalog, 50 rows per request, so rows
  that no other sync touched follow AniList too;
- a row the offline catalog creates has no AniList payload yet. Until AniList
  reports, it is hidden when the offline entry carries the ``hentai`` tag (that
  database's mirror of the providers' adult flag). The first AniList payload or
  sync replaces that guess. This is the only place a tag is read.

Migration 0060 seeded the flag for existing rows from the Hentai genre (which
AniList assigns only to ``isAdult`` media) or a ``hentai`` tag, without unhiding
rows that have no AniList data; deploy-prod.sh then queues the sync, which
replaces the seed with AniList's own value.
"""

from collections.abc import Iterable

from django.apps import apps
from django.db import transaction

from ..shared.logger import logger

# The offline catalog's adult marker, used only until AniList reports (see above).
OFFLINE_PROVISIONAL_ADULT_TAG = "hentai"


def anilist_is_adult(item) -> bool | None:
    """AniList's ``isAdult`` from a payload: True/False, or None when the payload lacks it."""
    if not isinstance(item, dict):
        return None
    value = item.get("isAdult")
    return value if isinstance(value, bool) else None


def offline_entry_is_provisionally_adult(tags) -> bool:
    """Hide a new offline-catalog row until AniList reports, when its entry is tagged hentai."""
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list | tuple):
        return False
    return any(
        isinstance(tag, str) and tag.strip().casefold() == OFFLINE_PROVISIONAL_ADULT_TAG
        for tag in tags
    )


def apply_anilist_adult_flags(payloads: Iterable[dict], *, using: str = "default") -> dict:
    """Store ``isAdult`` from these AniList payloads on the matching rows.

    Rows are matched by AniList ID, else by MAL ID. Payloads without ``isAdult``
    are skipped. Returns ``{"flagged": n, "cleared": n}`` (rows changed).
    """
    anime_model = apps.get_model("anime", "Anime")
    adult_ids: set[int] = set()
    general_ids: set[int] = set()
    adult_mal: set[int] = set()
    general_mal: set[int] = set()
    for payload in payloads:
        flag = anilist_is_adult(payload)
        if flag is None:
            continue
        # AniList returns both IDs. Rows with an AniList ID match on it; rows
        # that only have a MAL ID match on idMal (anilist_id__isnull below).
        if payload.get("id"):
            (adult_ids if flag else general_ids).add(payload["id"])
        if payload.get("idMal"):
            (adult_mal if flag else general_mal).add(payload["idMal"])

    rows = anime_model.objects.using(using)
    to_flag = dict(
        rows.filter(is_adult=False, anilist_id__in=adult_ids).values_list("pk", "slug")
    ) | dict(
        rows.filter(is_adult=False, anilist_id__isnull=True, mal_id__in=adult_mal).values_list(
            "pk", "slug"
        )
    )
    to_clear = dict(
        rows.filter(is_adult=True, anilist_id__in=general_ids).values_list("pk", "slug")
    ) | dict(
        rows.filter(is_adult=True, anilist_id__isnull=True, mal_id__in=general_mal).values_list(
            "pk", "slug"
        )
    )
    flagged = rows.filter(pk__in=to_flag, is_adult=False).update(is_adult=True)
    cleared = rows.filter(pk__in=to_clear, is_adult=True).update(is_adult=False)
    if flagged or cleared:
        _invalidate_public_caches([*to_flag.values(), *to_clear.values()], using)
    return {"flagged": flagged, "cleared": cleared}


def sync_adult_flags_from_anilist(
    *,
    chunk_size: int = 500,
    limit: int | None = None,
    after_pk: int = 0,
    using: str = "default",
) -> dict:
    """Re-read ``isAdult`` from AniList for every row with an AniList or MAL ID.

    Uses the batched airing query (50 IDs per request, rate-limited by the
    client). A chunk whose request fails is skipped, not cleared: a missing
    payload never makes a row visible. Returns totals, how many payloads came
    back, and ``last_pk`` (the last row checked; rows after it are for the next
    call when ``limit`` stopped this one).
    """
    from .services.anilist import AniListService

    anime_model = apps.get_model("anime", "Anime")
    queryset = (
        anime_model.objects.using(using)
        .exclude(anilist_id__isnull=True, mal_id__isnull=True)
        .filter(pk__gt=after_pk)
        .order_by("pk")
        .values_list("pk", "anilist_id", "mal_id")
    )
    if limit:
        queryset = queryset[:limit]
    service = AniListService()
    totals = {"checked": 0, "payloads": 0, "flagged": 0, "cleared": 0, "last_pk": after_pk}
    batch: list[tuple[int, int | None, int | None]] = []

    def flush():
        anilist_ids = [anilist_id for _, anilist_id, _ in batch if anilist_id]
        mal_ids = [mal_id for _, anilist_id, mal_id in batch if not anilist_id and mal_id]
        payloads = service.get_airing_by_ids(anilist_ids=anilist_ids, mal_ids=mal_ids)
        changed = apply_anilist_adult_flags(payloads, using=using)
        totals["checked"] += len(batch)
        totals["payloads"] += len(payloads)
        totals["flagged"] += changed["flagged"]
        totals["cleared"] += changed["cleared"]
        totals["last_pk"] = batch[-1][0]
        batch.clear()

    for row in queryset.iterator(chunk_size=chunk_size):
        batch.append(row)
        if len(batch) >= chunk_size:
            flush()
    if batch:
        flush()
    if totals["flagged"] or totals["cleared"]:
        logger.info(
            "Adult flags synced from AniList: %s newly adult, %s cleared (%s rows checked)",
            totals["flagged"],
            totals["cleared"],
            totals["checked"],
        )
    return totals


def _drop_public_caches(slugs: Iterable[str]) -> None:
    """One list-cache (namespace) bump, then each row's cached detail payload."""
    from .services.public_anime_service import AnimePublicPayloadService
    from .signals import _invalidate_anime_public_caches  # signals imports models

    AnimePublicPayloadService.bump_collection_cache_namespace()
    for slug in slugs:
        _invalidate_anime_public_caches(slug, bump_namespace=False)


def _invalidate_public_caches(slugs: list[str], using: str) -> None:
    """After the flag update commits, drop the changed rows' cached public payloads.

    ``update()`` skips the save signals, so it is done here: an adult title must
    not linger in a cached anonymous list or detail page. When the cache is
    down, the slugs are kept in ``PendingPublicCacheInvalidation`` and dropped
    by ``replay_public_cache_invalidations`` once Redis is back (its entries
    persist across an outage).
    """

    def invalidate():
        from ..shared.errors import CACHE_ERRORS

        try:
            _drop_public_caches(slugs)
        except CACHE_ERRORS:
            pending = apps.get_model("anime", "PendingPublicCacheInvalidation")
            pending.objects.using(using).bulk_create(
                [pending(slug=slug) for slug in dict.fromkeys(slugs)], ignore_conflicts=True
            )
            logger.warning(
                "Cache down: %s anime kept for a cache invalidation replay",
                len(slugs),
                exc_info=True,
            )

    transaction.on_commit(invalidate, using=using)


def replay_public_cache_invalidations(*, using: str = "default", batch_size: int = 1000) -> int:
    """Drop the cached payloads of the anime kept while the cache was down.

    Returns how many were replayed. A cache error propagates and leaves the rows
    for the next run; rows added meanwhile are kept (deleted by primary key).
    """
    pending = apps.get_model("anime", "PendingPublicCacheInvalidation").objects.using(using)
    rows = list(pending.order_by("pk").values_list("pk", "slug")[:batch_size])
    if not rows:
        return 0
    _drop_public_caches(slug for _, slug in rows)
    pending.filter(pk__in=[pk for pk, _ in rows]).delete()
    logger.info("Replayed the cache invalidation of %s anime", len(rows))
    return len(rows)
