from __future__ import annotations

from django.db import transaction
from django.db.models import Case, IntegerField, Q, QuerySet, Value, When

from ...shared.public_cache import invalidate_public_cache_keys
from ..models import Anime
from .public_anime_service import AnimePublicPayloadService


class CatalogSyncService:
    """Build local catalog slices from the existing Anime table."""

    def get_trending_anime_ids(self, *, limit: int = 50) -> list[int]:
        queryset = (
            self._base_queryset()
            .filter(
                Q(popularity_rank__isnull=False)
                | Q(site_rank__isnull=False)
                | Q(member_count__gt=0)
                | Q(rating__isnull=False)
            )
            .annotate(
                airing_priority=Case(
                    When(status=Anime.AnimeStatus.airing, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
                popularity_missing=Case(
                    When(popularity_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                site_missing=Case(
                    When(site_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                rating_missing=Case(
                    When(rating__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
            )
            .order_by(
                "airing_priority",
                "popularity_missing",
                "popularity_rank",
                "site_missing",
                "site_rank",
                "rating_missing",
                "-rating",
                "-member_count",
                "-id",
            )
        )
        return self._slice_ids(queryset, limit)

    def get_seasonal_anime_ids(
        self,
        *,
        season: str,
        year: int,
        limit: int = 100,
    ) -> list[int]:
        queryset = (
            self._base_queryset()
            .filter(season__iexact=season, season_year=year)
            .annotate(
                popularity_missing=Case(
                    When(popularity_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                site_missing=Case(
                    When(site_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                rating_missing=Case(
                    When(rating__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                )
            )
            .order_by(
                "popularity_missing",
                "popularity_rank",
                "site_missing",
                "site_rank",
                "rating_missing",
                "-rating",
                "-member_count",
                "-id",
            )
        )
        return self._slice_ids(queryset, limit)

    def get_airing_anime_ids(self, *, limit: int = 500) -> list[int]:
        queryset = (
            self._base_queryset()
            .filter(status=Anime.AnimeStatus.airing)
            .annotate(
                next_airing_missing=Case(
                    When(next_airing_date__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                popularity_missing=Case(
                    When(popularity_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                site_missing=Case(
                    When(site_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                rating_missing=Case(
                    When(rating__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
            )
            .order_by(
                "next_airing_missing",
                "next_airing_date",
                "popularity_missing",
                "popularity_rank",
                "site_missing",
                "site_rank",
                "rating_missing",
                "-rating",
                "-member_count",
                "-id",
            )
        )
        return self._slice_ids(queryset, limit)

    def get_full_catalog_anime_ids(self, *, limit: int = 5000) -> list[int]:
        queryset = (
            self._base_queryset()
            .annotate(
                popularity_missing=Case(
                    When(popularity_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                site_missing=Case(
                    When(site_rank__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
                rating_missing=Case(
                    When(rating__isnull=True, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                )
            )
            .order_by(
                "site_missing",
                "site_rank",
                "popularity_missing",
                "popularity_rank",
                "rating_missing",
                "-rating",
                "-member_count",
                "-id",
            )
        )
        return self._slice_ids(queryset, limit)

    def refresh_trending_ranks(self, anime_ids: list[int]) -> int:
        rank_updates = {anime_id: index + 1 for index, anime_id in enumerate(anime_ids) if anime_id}

        with transaction.atomic():
            Anime.objects.filter(trending_rank__isnull=False).update(trending_rank=None)
            if not rank_updates:
                return 0

            Anime.objects.filter(id__in=rank_updates).update(
                trending_rank=Case(
                    *[When(id=anime_id, then=Value(rank)) for anime_id, rank in rank_updates.items()],
                    default=Value(None),
                    output_field=IntegerField(),
                )
            )

        invalidate_public_cache_keys(
            f"anime_trending:{AnimePublicPayloadService.PUBLIC_CACHE_VERSION}"
        )
        return len(rank_updates)

    @staticmethod
    def _base_queryset() -> QuerySet[Anime]:
        return Anime.public_queryset().only(
            "id",
            "status",
            "season",
            "season_year",
            "popularity_rank",
            "site_rank",
            "trending_rank",
            "member_count",
            "rating",
            "next_airing_date",
        )

    @staticmethod
    def _slice_ids(queryset: QuerySet[Anime], limit: int) -> list[int]:
        resolved_limit = max(int(limit or 0), 0)
        if resolved_limit == 0:
            return []
        return list(queryset.values_list("id", flat=True)[:resolved_limit])
