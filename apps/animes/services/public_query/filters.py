"""Query-string filters for the public anime list, and the adult-content exclusion."""

import json
from datetime import date

from django.db import connections
from django.db.models import Count, Q

from ....shared.parsing import positive_int
from ....users.models import UserProfile
from ...models import Genre
from .sorting import VALID_SEASONS

VALID_STATUSES = {"airing", "finished", "upcoming", "not_yet_aired"}
VALID_TYPES = {"tv", "movie", "ova", "ona", "special", "music"}
MAX_RATING = 10.0
MIN_RATING = 0.0
MIN_SEARCH_LENGTH = 2
MIN_SYNOPSIS_SEARCH_LENGTH = 3
SEASON_MONTH_RANGES = {
    "winter": ((1, 1), (3, 31)),
    "spring": ((4, 1), (6, 30)),
    "summer": ((7, 1), (9, 30)),
    "fall": ((10, 1), (12, 31)),
}
# Query parameters that count as "filters" for the sort variants.
NON_TEMPORAL_FILTER_PARAMS = (
    "min_rating",
    "max_rating",
    "min_episodes",
    "max_episodes",
    "min_duration",
    "max_duration",
)
TEMPORAL_FILTER_PARAMS = ("season", "year", "min_year", "max_year")


class ListFilterMixin:
    """Filters for ``AnimeQueryService``; needs ``_apply_sort``."""

    def _apply_list_filters(self, queryset, request):
        query_params = request.query_params

        if not self.can_view_adult_content(request.user):
            queryset = self._exclude_adult_content(queryset)

        search = (query_params.get("q") or "").strip()
        search_is_active = len(search) >= MIN_SEARCH_LENGTH
        if search_is_active:
            queryset = self._apply_search(queryset, search)

        genres = self._parse_multi_value_params(query_params.getlist("genre"))
        if genres:
            genre_slugs = list(dict.fromkeys(genres))
            genre_ids = list(
                Genre.objects.filter(slug__in=genre_slugs).values_list("id", flat=True)
            )
            if len(genre_ids) != len(genre_slugs):
                return queryset.none()

            queryset = (
                queryset.filter(genres__in=genre_ids)
                .annotate(
                    matched_genre_count=Count(
                        "genres",
                        filter=Q(genres__in=genre_ids),
                        distinct=True,
                    )
                )
                .filter(matched_genre_count=len(genre_ids))
            )

        anime_status = query_params.get("status")
        queryset = self._filter_case_insensitive_values(
            queryset, anime_status, "status", VALID_STATUSES
        )

        anime_type = query_params.get("type")
        queryset = self._filter_case_insensitive_values(
            queryset, anime_type, "anime_type", VALID_TYPES
        )

        studio = query_params.get("studio")
        if studio:
            try:
                studio_id = int(studio)
            except (TypeError, ValueError):
                studio_id = None
            if studio_id and studio_id > 0:
                queryset = queryset.filter(studios__id=studio_id)

        queryset = self._apply_numeric_range_filter(
            queryset,
            "rating",
            query_params.get("min_rating"),
            query_params.get("max_rating"),
            min_allowed=MIN_RATING,
            max_allowed=MAX_RATING,
            value_type=float,
        )

        source_material = query_params.get("source")
        if source_material:
            queryset = queryset.filter(source_material__iexact=source_material.strip())

        tags = []
        tags_param = query_params.get("tags")
        if tags_param:
            tags = [tag.strip().lower() for tag in tags_param.split(",") if tag.strip()]
            queryset = self._apply_tags_filter(queryset, tags)

        exclude_ids = self._parse_positive_int_params(query_params.get("exclude_ids"))
        if exclude_ids:
            # Home shelves may deep-link into browse with already-shown cards removed.
            queryset = queryset.exclude(id__in=exclude_ids)

        shelf_scope = (query_params.get("shelf") or "").strip().lower()
        if shelf_scope == "all-time":
            queryset = queryset.filter(member_count__gt=self.CURATED_SHELF_MIN_MEMBER_COUNT)

        queryset = self._apply_numeric_range_filter(
            queryset,
            "episode_count",
            query_params.get("min_episodes"),
            query_params.get("max_episodes"),
            min_allowed=0,
            max_allowed=10_000,
            value_type=int,
        )
        queryset = self._apply_numeric_range_filter(
            queryset,
            "duration_minutes",
            query_params.get("min_duration"),
            query_params.get("max_duration"),
            min_allowed=0,
            max_allowed=1_000,
            value_type=int,
        )

        queryset = self._apply_year_filters(queryset, query_params)

        has_temporal_filters = any(bool(query_params.get(name)) for name in TEMPORAL_FILTER_PARAMS)
        apply_temporal_popular_quality_filter = self._should_apply_temporal_popular_quality_filter(
            season=query_params.get("season"),
            year=query_params.get("year"),
        )

        has_non_temporal_filters = (
            search_is_active
            or bool(genres)
            or bool(anime_status)
            or bool(anime_type)
            or bool(studio)
            or bool(source_material)
            or bool(tags)
            or any(bool(query_params.get(name)) for name in NON_TEMPORAL_FILTER_PARAMS)
        )
        has_active_filters = has_non_temporal_filters or has_temporal_filters

        sort_clean = (query_params.get("sort", "popular") or "popular").strip().lower()
        queryset, ordering = self._apply_sort(
            queryset,
            sort_clean=sort_clean,
            has_active_filters=has_active_filters,
            has_non_temporal_filters=has_non_temporal_filters,
            has_temporal_filters=has_temporal_filters,
            apply_temporal_popular_quality_filter=apply_temporal_popular_quality_filter,
            curate_for_shelves=False,
        )

        return queryset.order_by(*ordering)

    @staticmethod
    def _apply_search(queryset, search: str):
        search_words = search.split()
        if len(search_words) == 1:
            search_filter = Q(title__icontains=search) | Q(title_jp__icontains=search)
            if len(search) >= MIN_SYNOPSIS_SEARCH_LENGTH:
                search_filter |= Q(synopsis__icontains=search)
            return queryset.filter(search_filter)

        for word in search_words:
            if len(word) >= 2:
                queryset = queryset.filter(Q(title__icontains=word) | Q(title_jp__icontains=word))
        return queryset

    @staticmethod
    def can_view_adult_content(user) -> bool:
        if not getattr(user, "is_authenticated", False):
            return False

        cached_value = getattr(user, "_show_adult_content_cache", None)
        if cached_value is not None:
            return cached_value

        resolved = UserProfile.objects.filter(user_id=user.id, show_adult_content=True).exists()

        # Cache the preference on the user object so multi-shelf browse requests only resolve it once.
        user._show_adult_content_cache = resolved
        return resolved

    @staticmethod
    def _exclude_adult_content(queryset):
        # ``is_adult`` stores the genre/tag rule (see ``adult_content.py``, D5).
        return queryset.filter(is_adult=False)

    @staticmethod
    def _parse_multi_value_params(params: list[str]) -> list[str]:
        values = []
        for param in params:
            if param == "all":
                continue
            if "," in param:
                values.extend(part for part in param.split(",") if part)
            elif param:
                values.append(param)
        return values

    @staticmethod
    def _parse_positive_int_params(raw_value: str | None) -> list[int]:
        if not raw_value:
            return []

        return [parsed for value in raw_value.split(",") if (parsed := positive_int(value))]

    @staticmethod
    def _filter_case_insensitive_values(
        queryset, raw_value, field_name: str, valid_values: set[str]
    ):
        if not raw_value:
            return queryset

        resolved_values = [value.strip().lower() for value in raw_value.split(",")]
        valid_resolved = [value for value in resolved_values if value in valid_values]
        if not valid_resolved:
            return queryset

        condition = Q()
        for value in valid_resolved:
            condition |= Q(**{f"{field_name}__iexact": value})
        return queryset.filter(condition)

    @staticmethod
    def _parse_bound(raw_value, value_type, min_allowed, max_allowed):
        if raw_value in (None, ""):
            return None
        try:
            resolved = value_type(raw_value)
        except (TypeError, ValueError):
            return None
        return resolved if min_allowed <= resolved <= max_allowed else None

    @classmethod
    def _apply_numeric_range_filter(
        cls,
        queryset,
        field_name: str,
        min_value,
        max_value,
        *,
        min_allowed,
        max_allowed,
        value_type,
    ):
        min_resolved = cls._parse_bound(min_value, value_type, min_allowed, max_allowed)
        if min_resolved is not None:
            queryset = queryset.filter(**{f"{field_name}__gte": min_resolved})

        max_resolved = cls._parse_bound(max_value, value_type, min_allowed, max_allowed)
        if max_resolved is not None:
            queryset = queryset.filter(**{f"{field_name}__lte": max_resolved})

        return queryset

    @staticmethod
    def _apply_tags_filter(queryset, tags: list[str]):
        if not tags:
            return queryset

        db_vendor = connections[queryset.db].vendor
        for tag in tags:
            if db_vendor == "postgresql":
                queryset = queryset.filter(tags__contains=[tag])
                continue

            # SQLite lacks JSON contains lookups, so match the quoted JSON string instead.
            queryset = queryset.filter(tags__icontains=json.dumps(tag))

        return queryset

    @staticmethod
    def _year_bounds(year: int) -> tuple[date, date]:
        return date(year, 1, 1), date(year, 12, 31)

    @staticmethod
    def _parse_year(raw_value) -> int | None:
        try:
            year = int(raw_value)
        except (TypeError, ValueError):
            return None
        return year if year and 1980 <= year <= 2050 else None

    @classmethod
    def _apply_year_filters(cls, queryset, query_params):
        season = query_params.get("season")
        year = query_params.get("year")
        if year:
            year_int = cls._parse_year(year)
            if year_int is None:
                return queryset
            season_clean = season.strip().lower() if season else None
            if season_clean and season_clean in VALID_SEASONS:
                start, end = SEASON_MONTH_RANGES[season_clean]
                explicit_season_match = Q(season__iexact=season_clean, season_year=year_int)
                release_date_fallback = (
                    Q(season="", season_year__isnull=True)
                    | Q(season="", season_year=year_int)
                    | Q(season_year__isnull=True)
                ) & Q(
                    release_date__gte=date(year_int, *start),
                    release_date__lte=date(year_int, *end),
                )
                return queryset.filter(explicit_season_match | release_date_fallback)
            start, end = cls._year_bounds(year_int)
            return queryset.filter(
                Q(season_year=year_int)
                | Q(season_year__isnull=True, release_date__gte=start, release_date__lte=end)
            )

        min_year_int = cls._parse_year(query_params.get("min_year"))
        if min_year_int is not None:
            min_start, _ = cls._year_bounds(min_year_int)
            queryset = queryset.filter(
                # Upcoming rows often only have season metadata, so keep them in year-range views.
                Q(season_year__gte=min_year_int)
                | Q(season_year__isnull=True, release_date__gte=min_start)
            )

        max_year_int = cls._parse_year(query_params.get("max_year"))
        if max_year_int is not None:
            _, max_end = cls._year_bounds(max_year_int)
            queryset = queryset.filter(
                # Treat season_year as the canonical year when release_date is still unknown.
                Q(season_year__lte=max_year_int)
                | Q(season_year__isnull=True, release_date__lte=max_end)
            )

        return queryset
