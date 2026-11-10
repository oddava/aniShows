"""Shelf querysets: the browse rows, top-rated, related and fallback recommendations."""

from django.db.models import Case, Count, IntegerField, Value, When

from ...models import Anime


class ShelfMixin:
    """Shelves for ``AnimeQueryService``.

    Needs the field, filter and sorting mixins and ``_current_and_next_seasons()``.
    """

    BROWSE_ROW_PAGE_SIZE = 12

    def shelf_queryset_for(self, can_view_adult_content: bool):
        queryset = self.base_shelf_queryset()
        if not can_view_adult_content:
            queryset = self._exclude_adult_content(queryset)
        return queryset

    @classmethod
    def base_shelf_queryset(cls):
        return (
            Anime.public_queryset()
            .only(*cls.SHELF_FIELDS)
            .prefetch_related(cls._genre_prefetch(), Anime.studios_prefetch())
        )

    def browse_row_queryset(
        self,
        *,
        can_view_adult_content: bool,
        sort: str,
        season: str | None = None,
        year: int | None = None,
        limit: int | None = None,
        min_member_count: int | None = None,
        exclude_ids: list[int] | None = None,
    ):
        queryset = self.base_shelf_queryset()

        if not can_view_adult_content:
            queryset = self._exclude_adult_content(queryset)

        if exclude_ids:
            queryset = queryset.exclude(id__in=exclude_ids)

        if min_member_count is not None:
            queryset = queryset.filter(member_count__gt=min_member_count)

        has_temporal_filters = bool(season or year)
        apply_temporal_popular_quality_filter = self._should_apply_temporal_popular_quality_filter(
            season=season,
            year=year,
        )
        if has_temporal_filters:
            queryset = self._apply_year_filters(
                queryset,
                {"season": season or "", "year": str(year or "")},
            )

        queryset, ordering = self._apply_sort(
            queryset,
            sort_clean=sort,
            has_active_filters=has_temporal_filters,
            has_non_temporal_filters=False,
            has_temporal_filters=has_temporal_filters,
            apply_temporal_popular_quality_filter=apply_temporal_popular_quality_filter,
            curate_for_shelves=True,
        )
        queryset = queryset.order_by(*ordering)

        resolved_limit = limit or self.BROWSE_ROW_PAGE_SIZE
        return queryset[:resolved_limit]

    def _browse_row_specs(self) -> list[dict]:
        current_season, current_year, next_season, next_year = self._current_and_next_seasons()
        return [
            {
                "key": "trending",
                "title": "Trending Now",
                "browse_params": {"sort": "trending"},
                "query_kwargs": {"sort": "trending"},
            },
            {
                "key": "popular-season",
                "title": "Popular This Season",
                "browse_params": {
                    "season": current_season,
                    "year": str(current_year),
                    "sort": "popular",
                },
                "query_kwargs": {
                    "season": current_season,
                    "year": current_year,
                    "sort": "popular",
                },
            },
            {
                "key": "upcoming",
                "title": "Upcoming Next Season",
                "browse_params": {
                    "season": next_season,
                    "year": str(next_year),
                    "sort": "popular",
                },
                "query_kwargs": {
                    "season": next_season,
                    "year": next_year,
                    "sort": "popular",
                },
            },
            {
                "key": "all-time",
                "title": "All Time Popular",
                "browse_params": {"sort": "popular", "shelf": "all-time"},
                "query_kwargs": {
                    "sort": "popular",
                    "min_member_count": self.CURATED_SHELF_MIN_MEMBER_COUNT,
                },
            },
            {
                "key": "top-rated",
                "title": "Top Rated",
                "browse_params": {"sort": "rating"},
                "query_kwargs": {"sort": "rating"},
            },
        ]

    def browse_row_definitions(self, *, can_view_adult_content: bool) -> list[dict]:
        rows = []
        seen_ids: list[int] = []
        for row_spec in self._browse_row_specs():
            anime_list = list(
                self.browse_row_queryset(
                    can_view_adult_content=can_view_adult_content,
                    exclude_ids=seen_ids,
                    **row_spec["query_kwargs"],
                )
            )
            seen_ids.extend(anime.id for anime in anime_list)
            rows.append(
                {
                    "key": row_spec["key"],
                    "title": row_spec["title"],
                    "browse_params": row_spec["browse_params"],
                    "queryset": anime_list,
                }
            )

        return rows

    def related_queryset(self, anime, *, can_view_adult_content: bool = True):
        related_ids = self._related_anime_ids(anime)[:8]
        base_queryset = self.shelf_queryset_for(can_view_adult_content)

        if related_ids:
            ordering = Case(
                *[
                    When(id=anime_id, then=Value(index))
                    for index, anime_id in enumerate(related_ids)
                ],
                default=Value(len(related_ids)),
                output_field=IntegerField(),
            )
            return (
                base_queryset.filter(id__in=related_ids)
                .annotate(relation_order=ordering)
                .order_by("relation_order", "-id")
            )

        genre_ids = self._genre_ids(anime)
        return (
            base_queryset.filter(genres__in=genre_ids)
            .exclude(id=anime.id)
            .annotate(shared_genres=Count("genres"))
            .order_by("-shared_genres", "-id")[:8]
        )

    def _fallback_recommendations_queryset(self, anime, *, can_view_adult_content: bool = True):
        relation_mal_ids = self._relation_mal_ids(anime)
        related_ids = self._related_anime_ids(anime)
        genre_ids = self._genre_ids(anime)

        queryset = self.shelf_queryset_for(can_view_adult_content).exclude(id=anime.id)
        if relation_mal_ids:
            queryset = queryset.exclude(mal_id__in=relation_mal_ids)
        if related_ids:
            queryset = queryset.exclude(id__in=related_ids)

        return (
            queryset.filter(genres__in=genre_ids)
            .annotate(shared_genres=Count("genres"))
            .order_by("-shared_genres", "-rating", "-id")[:8]
        )

    @staticmethod
    def _relation_mal_ids(anime) -> list[int]:
        relation_ids = []
        for target_mal_id, linked_mal_id in anime.relations.values_list(
            "target_mal_id", "to_anime__mal_id"
        ):
            relation_mal_id = target_mal_id or linked_mal_id
            if relation_mal_id and relation_mal_id != anime.mal_id:
                relation_ids.append(relation_mal_id)
        return list(dict.fromkeys(relation_ids))

    @staticmethod
    def _related_anime_ids(anime) -> list[int]:
        """Linked related anime IDs in provider order."""
        related_ids = (
            anime.relations.filter(to_anime__isnull=False)
            .exclude(to_anime=anime.id)
            .values_list("to_anime_id", flat=True)
        )
        return list(dict.fromkeys(related_ids))

    @staticmethod
    def _genre_ids(anime) -> list[int]:
        prefetched_genres = getattr(anime, "_prefetched_objects_cache", {}).get("genres")
        if prefetched_genres is not None:
            # Related/recommendation actions already prefetch genres on the source anime.
            return [genre.id for genre in prefetched_genres]
        return list(anime.genres.values_list("id", flat=True))
