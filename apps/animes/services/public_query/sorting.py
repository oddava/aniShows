"""Sort orders for the public list and the browse shelves.

This module only depends on Django (``Anime.Meta`` imports it for an index).

Each sort key has a small table of *variants*, and each variant is a
``SortPlan``: the filters it adds, the annotations it needs (applied in order,
one ``annotate()`` call each) and the ``ORDER BY``. ``SortContext`` picks the
variant: shelves are curated (they drop rows without the signal they sort by),
while the list keeps every row and pushes rows with missing data to the end.
"""

import copy
from dataclasses import dataclass
from datetime import date

from django.db.models import Case, F, IntegerField, Q, Value, When
from django.db.models.functions import Coalesce

CURATED_SHELF_MIN_MEMBER_COUNT = 200_000
FILTERED_POPULAR_MIN_MEMBER_COUNT = 25_000
FILTERED_POPULAR_MAX_RANK = 5_000
FILTERED_POPULAR_MIN_RATING = 7.0
FILTERED_POPULAR_RATED_MIN_MEMBER_COUNT = 5_000
TEMPORAL_POPULAR_MIN_MEMBER_COUNT = 5_000
TEMPORAL_POPULAR_MAX_RANK = 15_000
SEASON_ORDER = {"winter": 0, "spring": 1, "summer": 2, "fall": 3}
VALID_SEASONS = set(SEASON_ORDER)
# Base ordering per sort key; unknown keys sort like "popular".
SORT_MAPPING = {
    "popular": "popularity_rank",
    "rating": "-rating",
    "newest": "-release_date",
    "title": "title",
    "upcoming": "-member_count",
    "trending": "trending_rank",
}
DEFAULT_SORT_FIELD = "popularity_rank"


def positive_rank_q(field_name: str, *, max_rank: int | None = None) -> Q:
    condition = Q(**{f"{field_name}__isnull": False, f"{field_name}__gt": 0})
    if max_rank is not None:
        condition &= Q(**{f"{field_name}__lte": max_rank})
    return condition


def missing_rank_q(field_name: str) -> Q:
    return Q(**{f"{field_name}__isnull": True}) | Q(**{f"{field_name}__lte": 0})


def _missing_flag(condition: Q) -> Case:
    """1 when ``condition`` holds, else 0: sorts rows with missing data last."""
    return Case(When(condition, then=Value(1)), default=Value(0), output_field=IntegerField())


def _quality_bucket(condition: Q) -> Case:
    """0 for rows that pass ``condition``, else 1: sorts high-signal rows first."""
    return Case(When(condition, then=Value(0)), default=Value(1), output_field=IntegerField())


TEMPORAL_POPULAR_QUALITY_Q = (
    Q(member_count__gte=TEMPORAL_POPULAR_MIN_MEMBER_COUNT)
    | positive_rank_q("popularity_rank", max_rank=TEMPORAL_POPULAR_MAX_RANK)
    | positive_rank_q("site_rank", max_rank=TEMPORAL_POPULAR_MAX_RANK)
)
FILTERED_POPULAR_QUALITY_Q = (
    Q(member_count__gte=FILTERED_POPULAR_MIN_MEMBER_COUNT)
    | positive_rank_q("popularity_rank", max_rank=FILTERED_POPULAR_MAX_RANK)
    | positive_rank_q("site_rank", max_rank=FILTERED_POPULAR_MAX_RANK)
    | (
        Q(rating__isnull=False)
        & Q(rating__gte=FILTERED_POPULAR_MIN_RATING)
        & Q(member_count__gte=FILTERED_POPULAR_RATED_MIN_MEMBER_COUNT)
    )
)


@dataclass(frozen=True, slots=True)
class SortPlan:
    filters: tuple[Q, ...] = ()
    annotations: tuple[dict, ...] = ()
    ordering: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SortContext:
    curate_for_shelves: bool
    has_active_filters: bool
    has_temporal_filters: bool
    apply_temporal_popular_quality_filter: bool


def _default_plan(sort_key: str) -> SortPlan:
    return SortPlan(ordering=(SORT_MAPPING.get(sort_key, DEFAULT_SORT_FIELD), "-id"))


_POPULAR_TEMPORAL = SortPlan(
    annotations=(
        {
            "popular_quality_bucket": _quality_bucket(TEMPORAL_POPULAR_QUALITY_Q),
            # Future-season rows often arrive before a canonical popularity rank exists.
            "popularity_missing": _missing_flag(missing_rank_q("popularity_rank")),
            # Keep site_rank as a secondary signal before falling back to raw member counts.
            "site_missing": _missing_flag(missing_rank_q("site_rank")),
            "rating_missing": _missing_flag(Q(rating__isnull=True)),
            "member_sort": Coalesce(F("member_count"), Value(0)),
        },
    ),
    ordering=(
        "popular_quality_bucket",
        "popularity_missing",
        "popularity_rank",
        "site_missing",
        "site_rank",
        "rating_missing",
        "-rating",
        "-member_sort",
        "-id",
    ),
)

# sort key -> variant -> plan. ``_variant`` says which variant applies.
SORT_TABLE: dict[str, dict[str, SortPlan]] = {
    "rating": {
        "shelf": SortPlan(
            filters=(Q(rating__isnull=False, member_count__gt=200000),),
            ordering=("-rating", "-id"),
        ),
        "list": SortPlan(
            annotations=(
                {
                    "rating_missing": _missing_flag(Q(rating__isnull=True)),
                    "member_sort": Coalesce(F("member_count"), Value(0)),
                    "popularity_missing": _missing_flag(missing_rank_q("popularity_rank")),
                },
            ),
            ordering=(
                "rating_missing",
                "-rating",
                "popularity_missing",
                "popularity_rank",
                "-member_sort",
                "-id",
            ),
        ),
    },
    "newest": {
        "shelf": SortPlan(
            filters=(Q(episode_count__gt=0),),
            ordering=("-release_date", "-id"),
        ),
        "list": SortPlan(
            annotations=(
                {
                    "release_missing": _missing_flag(Q(release_date__isnull=True)),
                    "season_year_missing": _missing_flag(Q(season_year__isnull=True)),
                },
            ),
            ordering=(
                "release_missing",
                "-release_date",
                "season_year_missing",
                "-season_year",
                "-id",
            ),
        ),
    },
    "upcoming": {
        "any": SortPlan(filters=(Q(status="Upcoming"),), ordering=("-member_count", "-id")),
    },
    "popular": {
        # Unfiltered shelves: ranked rows only, in rank order.
        "shelf": SortPlan(
            filters=(positive_rank_q("popularity_rank"),),
            ordering=("popularity_rank", "-id"),
        ),
        "temporal": _POPULAR_TEMPORAL,
        # Current/future season shelves also drop low-signal rows.
        "temporal_quality_shelf": SortPlan(
            filters=(TEMPORAL_POPULAR_QUALITY_Q,),
            annotations=_POPULAR_TEMPORAL.annotations,
            ordering=_POPULAR_TEMPORAL.ordering,
        ),
        "filtered_shelf": SortPlan(
            annotations=({"member_sort": Coalesce(F("member_count"), 0)},),
            ordering=("-member_sort", "-id"),
        ),
        "list": SortPlan(
            annotations=(
                {"member_sort": Coalesce(F("member_count"), 0)},
                {
                    "filtered_popular_quality_bucket": _quality_bucket(FILTERED_POPULAR_QUALITY_Q),
                    "popularity_missing": _missing_flag(missing_rank_q("popularity_rank")),
                    "site_missing": _missing_flag(missing_rank_q("site_rank")),
                    "rating_missing": _missing_flag(Q(rating__isnull=True)),
                },
            ),
            ordering=(
                "filtered_popular_quality_bucket",
                "popularity_missing",
                "popularity_rank",
                "site_missing",
                "site_rank",
                "rating_missing",
                "-rating",
                "-member_sort",
                "-id",
            ),
        ),
    },
    "trending": {
        "shelf": SortPlan(
            filters=(positive_rank_q("trending_rank"),),
            ordering=("trending_rank", "-id"),
        ),
        "list": SortPlan(
            annotations=(
                {
                    "trending_missing": _missing_flag(missing_rank_q("trending_rank")),
                    "popularity_missing": _missing_flag(missing_rank_q("popularity_rank")),
                    "member_sort": Coalesce(F("member_count"), Value(0)),
                },
            ),
            ordering=(
                "trending_missing",
                "trending_rank",
                "popularity_missing",
                "popularity_rank",
                "-member_sort",
                "-id",
            ),
        ),
    },
}
# The list's rating sort without any filter is the curated top-rated view.
SORT_TABLE["rating"]["unfiltered_list"] = SortPlan(
    filters=(Q(rating__isnull=False, member_count__gt=CURATED_SHELF_MIN_MEMBER_COUNT),),
    annotations=SORT_TABLE["rating"]["list"].annotations,
    ordering=SORT_TABLE["rating"]["list"].ordering,
)


def _variant(sort_key: str, context: SortContext) -> str:
    shelf = context.curate_for_shelves
    if sort_key == "upcoming":
        return "any"
    if sort_key == "rating" and not shelf and not context.has_active_filters:
        return "unfiltered_list"
    if sort_key == "popular":
        if shelf and not context.has_active_filters:
            return "shelf"
        if context.has_temporal_filters:
            if shelf and context.apply_temporal_popular_quality_filter:
                return "temporal_quality_shelf"
            return "temporal"
        return "filtered_shelf" if shelf else "list"
    return "shelf" if shelf else "list"


def sort_plan(sort_key: str, context: SortContext) -> SortPlan:
    variants = SORT_TABLE.get(sort_key)
    if variants is None:  # "title" and unknown keys only order by their base field
        return _default_plan(sort_key)
    return variants[_variant(sort_key, context)]


def popular_list_index_expressions() -> list:
    """The default list ordering (popular, no filters) as index expressions.

    ``Anime.Meta`` builds the partial index ``anime_public_popular_list_idx``
    (``WHERE NOT is_adult``) from these, so Postgres can read the anonymous
    default list and search in order instead of sorting the whole table. They
    come from the same plan the queries use, so the two cannot drift apart;
    ``test_public_list_index.py`` checks the planner still picks the index.
    """
    plan = SORT_TABLE["popular"]["list"]
    annotations = {name: expr for group in plan.annotations for name, expr in group.items()}
    expressions = []
    for name in plan.ordering:
        field_name = name.removeprefix("-")
        expression = copy.deepcopy(annotations.get(field_name, F(field_name)))
        expressions.append(expression.desc() if name.startswith("-") else expression)
    return expressions


def apply_sort_plan(queryset, plan: SortPlan):
    for condition in plan.filters:
        queryset = queryset.filter(condition)
    for annotations in plan.annotations:
        queryset = queryset.annotate(**annotations)
    return queryset, list(plan.ordering)


class SortingMixin:
    """Sorting for ``AnimeQueryService``; needs ``_current_and_next_seasons()``."""

    CURATED_SHELF_MIN_MEMBER_COUNT = CURATED_SHELF_MIN_MEMBER_COUNT
    FILTERED_POPULAR_MIN_MEMBER_COUNT = FILTERED_POPULAR_MIN_MEMBER_COUNT
    FILTERED_POPULAR_MAX_RANK = FILTERED_POPULAR_MAX_RANK
    FILTERED_POPULAR_MIN_RATING = FILTERED_POPULAR_MIN_RATING
    FILTERED_POPULAR_RATED_MIN_MEMBER_COUNT = FILTERED_POPULAR_RATED_MIN_MEMBER_COUNT
    TEMPORAL_POPULAR_MIN_MEMBER_COUNT = TEMPORAL_POPULAR_MIN_MEMBER_COUNT
    TEMPORAL_POPULAR_MAX_RANK = TEMPORAL_POPULAR_MAX_RANK
    SEASON_ORDER = SEASON_ORDER
    SORT_MAPPING = SORT_MAPPING

    _positive_rank_q = staticmethod(positive_rank_q)
    _missing_rank_q = staticmethod(missing_rank_q)

    @classmethod
    def _apply_sort(
        cls,
        queryset,
        *,
        sort_clean: str,
        has_active_filters: bool,
        has_non_temporal_filters: bool = False,
        has_temporal_filters: bool,
        apply_temporal_popular_quality_filter: bool = False,
        curate_for_shelves: bool = False,
    ):
        """Return ``(queryset, ordering)`` for ``sort_clean``; the caller applies the ordering."""
        context = SortContext(
            curate_for_shelves=curate_for_shelves,
            has_active_filters=has_active_filters,
            has_temporal_filters=has_temporal_filters,
            apply_temporal_popular_quality_filter=apply_temporal_popular_quality_filter,
        )
        return apply_sort_plan(queryset, sort_plan(sort_clean, context))

    @classmethod
    def _apply_temporal_popular_quality_filter(cls, queryset):
        return queryset.filter(TEMPORAL_POPULAR_QUALITY_Q)

    @classmethod
    def _should_apply_temporal_popular_quality_filter(
        cls,
        *,
        season: str | None,
        year: int | str | None,
    ) -> bool:
        """True for the current or a future season: those shelves drop low-signal rows."""
        season_clean = str(season or "").strip().lower()
        if season_clean not in VALID_SEASONS:
            return False

        try:
            year_int = int(year)
        except (TypeError, ValueError):
            return False

        current_season, current_year, _, _ = cls._current_and_next_seasons()
        requested_key = (year_int, SEASON_ORDER[season_clean])
        current_key = (current_year, SEASON_ORDER[current_season])
        return requested_key >= current_key

    @classmethod
    def season_window_for_date(cls, target_date: date) -> tuple[str, int, str, int]:
        month = target_date.month
        year = target_date.year

        current_season = "winter"
        if 4 <= month <= 6:
            current_season = "spring"
        elif 7 <= month <= 9:
            current_season = "summer"
        elif 10 <= month <= 12:
            current_season = "fall"

        next_season = "winter"
        next_year = year
        if 1 <= month <= 3:
            next_season = "spring"
        elif 4 <= month <= 6:
            next_season = "summer"
        elif 7 <= month <= 9:
            next_season = "fall"
        else:
            next_season = "winter"
            next_year = year + 1

        return current_season, year, next_season, next_year
