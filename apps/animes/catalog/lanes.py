"""The lanes: each one keeps one kind of catalog data fresh (see the package docstring).

A lane is a function ``lane(ctx, **options)``. It asks AniList through ``ctx.query``
(which counts requests and stops the lane when AniList fails), saves through
``ctx.save_many`` and leaves facts for the admin page in ``ctx.detail``. A lane that
runs out of time sets ``ctx.continue_later``; its cursor is saved after every page,
so the next run picks up exactly there.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from django.conf import settings
from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone

from ...shared.logger import logger
from ...shared.public_cache import invalidate_public_cache_keys
from ..models import Anime, CatalogCursor
from ..services.providers.anilist.persistence import OutOfCatalogScopeError
from . import queries, scope

if TYPE_CHECKING:
    from collections.abc import Iterable

    from ..models import CatalogRun
    from ..services.anilist import AniListService


class LaneStoppedError(Exception):
    """AniList failed (busy, down, rejected the query): stop here, keep the cursor."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


@dataclass
class LaneContext:
    run: CatalogRun
    service: AniListService
    deadline: float
    requests: int = 0
    fetched: int = 0
    created: int = 0
    updated: int = 0
    excluded: int = 0
    detail: dict[str, Any] = field(default_factory=dict)
    continue_later: bool = False
    touched_ids: list[int] = field(default_factory=list)

    # ---------------------------------------------------------------- requests

    def query(self, query: str, variables: dict) -> dict:
        self.requests += 1
        data = self.service._query(query, variables, use_cache=False)
        if not data:
            raise LaneStoppedError(
                self.service.last_error_code or "empty_response", self.service.last_error_message
            )
        return data

    def page(self, query: str, variables: dict) -> tuple[list[dict], bool]:
        """One ``Page``: its media and whether there is another page."""
        block = self.query(query, variables).get("Page") or {}
        media = [item for item in block.get("media") or [] if isinstance(item, dict)]
        return media, bool((block.get("pageInfo") or {}).get("hasNextPage"))

    def out_of_time(self) -> bool:
        return time.monotonic() >= self.deadline

    # ---------------------------------------------------------------- writes

    def save_many(self, media: Iterable[dict], *, mirror_images: bool = False) -> list[Anime]:
        """Save each payload on its own; one bad payload never stops the page."""
        self.service.mirror_images = mirror_images
        saved = []
        for item in media:
            self.fetched += 1
            anime = self._save_one(item)
            if anime is not None:
                saved.append(anime)
        return saved

    def _save_one(self, item: dict) -> Anime | None:
        anilist_id, mal_id = item.get("id"), item.get("idMal")
        lookup = Q(anilist_id=anilist_id) if anilist_id else Q(pk__in=[])
        if mal_id:
            lookup |= Q(mal_id=mal_id)
        before = Anime.objects.filter(lookup).values_list("catalog_excluded", flat=True).first()
        try:
            with transaction.atomic():
                anime = self.service.save_anime_to_db(item)
        except OutOfCatalogScopeError:
            return None  # not stored, and nothing to hide
        except Exception:  # noqa: BLE001 - one bad payload must not stop the page
            logger.warning(
                "Catalog lane could not save a title",
                extra={"anilist_id": anilist_id, "lane": self.run.lane},
                exc_info=True,
            )
            self.detail["save_errors"] = self.detail.get("save_errors", 0) + 1
            return None
        if before is None:
            self.created += 1
        elif anime.catalog_excluded and not before:
            self.excluded += 1
        else:
            self.updated += 1
        self.touched_ids.append(anime.id)
        return anime


# -------------------------------------------------------------------- cursors


def load_cursor(lane: str) -> dict:
    cursor = CatalogCursor.objects.filter(lane=lane).first()
    return dict(cursor.state) if cursor else {}


def save_cursor(lane: str, state: dict) -> None:
    CatalogCursor.objects.update_or_create(lane=lane, defaults={"state": state})


# -------------------------------------------------------------------- seasons

SEASON_ORDER = ("WINTER", "SPRING", "SUMMER", "FALL")


def season_of(day: date) -> tuple[str, int]:
    return SEASON_ORDER[(day.month - 1) // 3], day.year


def shift_season(season: str, year: int, steps: int) -> tuple[str, int]:
    index = SEASON_ORDER.index(season) + steps
    return SEASON_ORDER[index % 4], year + index // 4


def season_window(today: date | None = None) -> list[tuple[str, int]]:
    """Previous, current, next and the one after (titles get announced that far ahead)."""
    current = season_of(today or timezone.localdate())
    return [shift_season(*current, steps) for steps in (-1, 0, 1, 2)]


def seasons(ctx: LaneContext, **_options) -> None:
    counted = []
    query = queries.season_page()
    for season, year in season_window():
        total = 0
        for page in range(1, queries.MAX_PAGES + 1):
            media, more = ctx.page(
                query,
                {
                    "season": season,
                    "year": year,
                    "page": page,
                    "perPage": queries.PAGE_SIZE,
                    **scope.query_variables(),
                },
            )
            ctx.save_many(media)
            total += len(media)
            if not more:
                break
        counted.append({"season": season, "year": year, "anilist": total})
    ctx.detail["seasons"] = counted


# -------------------------------------------------------------------- delta

# Re-read this much before the cursor: AniList stamps a bulk edit with one time,
# and a page boundary can fall inside it.
DELTA_OVERLAP_SECONDS = 60 * 60
DELTA_FIRST_RUN_LOOKBACK = timedelta(hours=6)


def delta(ctx: LaneContext, **_options) -> None:
    """Every title AniList changed since the last run, newest first."""
    state = load_cursor("delta")
    since = int(state.get("since") or (timezone.now() - DELTA_FIRST_RUN_LOOKBACK).timestamp())
    stop_before = since - DELTA_OVERLAP_SECONDS
    newest = since
    reached_cursor = False
    pages = 0
    for page in range(1, queries.MAX_PAGES + 1):
        media, more = ctx.page(queries.CHANGES_PAGE, {"page": page, "perPage": queries.PAGE_SIZE})
        pages = page
        fresh = [item for item in media if int(item.get("updatedAt") or 0) > stop_before]
        ctx.save_many(fresh)
        for item in fresh:
            newest = max(newest, int(item.get("updatedAt") or 0))
        if len(fresh) < len(media) or not more:
            reached_cursor = True
            break
        if ctx.out_of_time():
            break
    ctx.detail.update(
        {"since": since, "newest": newest, "pages": pages, "reached_cursor": reached_cursor}
    )
    if not reached_cursor:
        # More changes than one run can read (AniList re-indexed a lot at once):
        # take what was read and let the sweep catch the rest.
        ctx.detail["overflow"] = True
        request_sweep()
    save_cursor("delta", {"since": newest})


# -------------------------------------------------------------------- trending

TRENDING_LIMIT = 50
# AniList answering with fewer than this is broken, not quiet: keep the old ranks.
MIN_TRENDING_RESULTS = 6


def trending(ctx: LaneContext, **_options) -> None:
    media, _more = ctx.page(
        queries.trending_page(),
        {"page": 1, "perPage": TRENDING_LIMIT, **scope.query_variables()},
    )
    if len(media) < MIN_TRENDING_RESULTS:
        ctx.detail["kept_old_ranks"] = True
        raise LaneStoppedError("too_few_results", f"AniList returned {len(media)} trending titles")
    saved = ctx.save_many(media)
    ranked = list(dict.fromkeys(anime.id for anime in saved if not anime.catalog_excluded))
    ctx.detail["ranked"] = refresh_trending_ranks(ranked)


def refresh_trending_ranks(anime_ids: list[int]) -> int:
    from ..services.public_anime_service import AnimePublicPayloadService

    ranks = {anime_id: index + 1 for index, anime_id in enumerate(anime_ids)}
    with transaction.atomic():
        Anime.objects.filter(trending_rank__isnull=False).update(trending_rank=None)
        if ranks:
            Anime.objects.filter(id__in=ranks).update(
                trending_rank=Case(
                    *[When(id=anime_id, then=Value(rank)) for anime_id, rank in ranks.items()],
                    default=Value(None),
                    output_field=IntegerField(),
                )
            )
    invalidate_public_cache_keys(
        *(
            f"anime_trending:{AnimePublicPayloadService.PUBLIC_CACHE_VERSION}:adult:{flag}"
            for flag in (0, 1)
        )
    )
    AnimePublicPayloadService.bump_collection_cache_namespace()
    return len(ranks)


# -------------------------------------------------------------------- airing


def airing(ctx: LaneContext, **_options) -> None:
    """Next-episode times for the shows on air (the airing workflow, 50 shows per request)."""
    from ..tasks.airing import AiringWorkflowTask

    runner = AiringWorkflowTask()
    runner.metrics.start()
    summary = runner._run_workflow(["sync", "cleanup", "backfill"], None, 1800)
    summary = summary if isinstance(summary, dict) else {}
    sync = summary.get("sync_summary") or {}
    backfill = summary.get("backfill_summary") or {}
    ctx.updated = int(sync.get("updated") or 0) + int(backfill.get("populated") or 0)
    ctx.fetched = int(sync.get("total") or 0)
    ctx.detail["airing"] = {
        "shows": sync.get("total", 0),
        "updated": sync.get("updated", 0),
        "finished": (summary.get("cleanup_summary") or {}).get("status_changed", 0),
        "dates_found": backfill.get("populated", 0),
    }


# -------------------------------------------------------------------- hydrate

HYDRATE_MAX_REQUESTS = 6
# The most popular titles are hydrated ahead of anyone asking.
HYDRATE_POPULAR_TOP = 3000
# Shows on air change cast and staff as they go.
HYDRATE_AIRING_STALE_AFTER = timedelta(days=7)


def hydrate_candidates(limit: int) -> list[int]:
    """Who gets details next: asked for, then this and next season, then popular, then stale."""
    picked: list[int] = []

    def take(queryset) -> None:
        if len(picked) >= limit:
            return
        ids = queryset.exclude(id__in=picked).values_list("id", flat=True)[: limit - len(picked)]
        picked.extend(ids)

    take(Anime.objects.filter(hydrate_requested_at__isnull=False).order_by("hydrate_requested_at"))
    public = Anime.public_queryset().filter(Q(anilist_id__isnull=False) | Q(mal_id__isnull=False))
    window = season_window()[1:3]
    in_window = Q()
    for season, year in window:
        in_window |= Q(season__iexact=season, season_year=year)
    take(public.filter(in_window, hydrated_at__isnull=True).order_by("-member_count", "id"))
    popular_ids = public.order_by("-member_count", "id").values("id")[:HYDRATE_POPULAR_TOP]
    take(
        public.filter(id__in=popular_ids, hydrated_at__isnull=True).order_by("-member_count", "id")
    )
    take(
        public.filter(
            status=Anime.AnimeStatus.airing,
            hydrated_at__lt=timezone.now() - HYDRATE_AIRING_STALE_AFTER,
        ).order_by("hydrated_at")
    )
    return picked


def hydrate(ctx: LaneContext, *, anime_ids: list[int] | None = None, **_options) -> None:
    limit = HYDRATE_MAX_REQUESTS * queries.FULL_PAGE_SIZE
    ids = list(anime_ids or []) or hydrate_candidates(limit)
    rows = list(Anime.objects.filter(id__in=ids).only("id", "anilist_id", "mal_id"))
    ctx.detail["asked"] = len(rows)
    if not rows:
        return
    by_anilist = [row.anilist_id for row in rows if row.anilist_id]
    by_mal = [row.mal_id for row in rows if not row.anilist_id and row.mal_id]
    for argument, values in (("id_in", by_anilist), ("idMal_in", by_mal)):
        query = queries.by_ids(argument, full=True)
        for start in range(0, len(values), queries.FULL_PAGE_SIZE):
            chunk = values[start : start + queries.FULL_PAGE_SIZE]
            media, _more = ctx.page(query, {"ids": chunk, "perPage": len(chunk)})
            ctx.save_many(media, mirror_images=True)
    # Rows AniList no longer has: stamped anyway, so they do not come back every run.
    Anime.objects.filter(id__in=[row.id for row in rows], hydrated_at__isnull=True).update(
        hydrated_at=timezone.now()
    )
    Anime.objects.filter(id__in=[row.id for row in rows]).update(hydrate_requested_at=None)


# -------------------------------------------------------------------- seed: the sweep

SEED_PHASES = ("backfill", "years", "unreleased", "done")


def request_sweep() -> None:
    """Start the sweep over at its next run (when it is not already under way)."""
    state = load_cursor("seed")
    if state.get("phase", "done") == "done":
        save_cursor("seed", {**state, "phase": "backfill", "restart_requested": True})


def _first_year() -> int:
    return int(getattr(settings, "CATALOG_FIRST_YEAR", 1917))


def seed(ctx: LaneContext, *, restart: bool = False, **_options) -> None:
    """The whole scope, resumable: stored rows' origins, then every year, then the unannounced.

    One year per window keeps every query far below AniList's 5,000-result page cap.
    Newest years first, so a fresh site fills up with what people look for first.
    """
    state = load_cursor("seed")
    if restart and state.get("phase", "done") == "done":
        state = {"phase": "backfill"}
    if not state:
        state = {"phase": "backfill"}
    state.pop("restart_requested", None)
    state.setdefault("started_at", timezone.now().isoformat())
    if state["phase"] == "done":
        ctx.detail["phase"] = "done"
        return

    ctx.detail["from"] = {key: state.get(key) for key in ("phase", "year", "page")}
    if state["phase"] == "backfill":
        if not _seed_backfill(ctx, state):
            return _pause(ctx, state)
        state.update({"phase": "years", "year": timezone.now().year + 1, "page": 1})
        save_cursor("seed", state)

    if state["phase"] == "years":
        if not _seed_years(ctx, state):
            return _pause(ctx, state)
        state.update({"phase": "unreleased", "page": 1})
        save_cursor("seed", state)

    if state["phase"] == "unreleased":
        if not _seed_pages(ctx, state, queries.unreleased_page(), {}):
            return _pause(ctx, state)

    from ..services.relation_links import link_pending_relations

    ctx.detail["relations_linked"] = link_pending_relations()
    ctx.detail["rescoped"] = scope.rescope_stored()
    finished = {"phase": "done", "completed_at": timezone.now().isoformat()}
    if state.get("started_at"):
        finished["started_at"] = state["started_at"]
    save_cursor("seed", finished)
    ctx.detail["to"] = {"phase": "done"}


def _pause(ctx: LaneContext, state: dict) -> None:
    save_cursor("seed", state)
    ctx.continue_later = True
    ctx.detail["to"] = {key: state.get(key) for key in ("phase", "year", "page")}


def _seed_backfill(ctx: LaneContext, state: dict) -> bool:
    """Rows stored before the engine (or by hand) learn their origin and format."""
    after = int(state.get("after_id") or 0)
    while not ctx.out_of_time():
        rows = list(
            Anime.objects.filter(id__gt=after, country_of_origin="")
            .filter(Q(anilist_id__isnull=False) | Q(mal_id__isnull=False))
            .order_by("id")
            .values_list("id", "anilist_id", "mal_id")[: queries.PAGE_SIZE]
        )
        if not rows:
            state.pop("after_id", None)
            return True
        anilist_ids = [anilist_id for _id, anilist_id, _mal in rows if anilist_id]
        mal_ids = [mal_id for _id, anilist_id, mal_id in rows if not anilist_id and mal_id]
        for argument, values in (("id_in", anilist_ids), ("idMal_in", mal_ids)):
            if values:
                media, _more = ctx.page(
                    queries.by_ids(argument, full=False), {"ids": values, "perPage": len(values)}
                )
                ctx.save_many(media)
        after = rows[-1][0]
        state["after_id"] = after
        save_cursor("seed", state)
    return False


def _seed_years(ctx: LaneContext, state: dict) -> bool:
    query = queries.year_page()
    while int(state["year"]) >= _first_year():
        year = int(state["year"])
        variables = {"after": year * 10000 - 1, "before": (year + 1) * 10000}
        if not _seed_pages(ctx, state, query, variables):
            return False
        state.update({"year": year - 1, "page": 1})
        save_cursor("seed", state)
    return True


def _seed_pages(ctx: LaneContext, state: dict, query: str, variables: dict) -> bool:
    """Every page of one window from ``state["page"]``; False when the run is out of time."""
    page = int(state.get("page") or 1)
    while page <= queries.MAX_PAGES:
        if ctx.out_of_time():
            return False
        media, more = ctx.page(
            query,
            {**variables, "page": page, "perPage": queries.PAGE_SIZE, **scope.query_variables()},
        )
        ctx.save_many(media)
        page += 1
        state["page"] = page
        save_cursor("seed", state)
        if not more:
            break
    return True


LANES = {
    "seasons": seasons,
    "delta": delta,
    "trending": trending,
    "airing": airing,
    "hydrate": hydrate,
    "seed": seed,
}


def _year_weight(year: int) -> int:
    """Rough share of titles per release year: recent years hold far more anime."""
    return max(year - 1955, 5)


def seed_progress() -> dict:
    """The sweep's position for the admin page: phase, year, and how far through the years."""
    state = load_cursor("seed")
    phase = state.get("phase", "not_started" if not state else "done")
    out: dict[str, Any] = {"phase": phase}
    for key in ("year", "page", "completed_at", "started_at"):
        if state.get(key) is not None:
            out[key] = state[key]
    if phase == "years" and state.get("year"):
        top = timezone.now().year + 1
        years = range(_first_year(), top + 1)
        done = sum(_year_weight(year) for year in years if year > int(state["year"]))
        total = sum(_year_weight(year) for year in years) or 1
        out["percent"] = round(min(max(done / total, 0), 0.98) * 100)
    elif phase in {"unreleased", "done"}:
        out["percent"] = 100 if phase == "done" else 99
    elif phase in {"backfill", "not_started"}:
        out["percent"] = 0
    return out


def utc_from_timestamp(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=UTC) if value else None
