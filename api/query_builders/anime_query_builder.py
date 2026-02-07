from typing import Optional, List
from dataclasses import dataclass

from api.repositories.anime_repository import AnimeRepository


@dataclass
class AnimeFilterParams:
    """Type-safe filter parameters for anime queries."""

    search: Optional[str] = None
    genres: List[str] = None
    status: Optional[str] = None
    anime_type: Optional[str] = None
    studio: Optional[int] = None
    min_rating: Optional[float] = None
    max_rating: Optional[float] = None
    year: Optional[int] = None
    season: Optional[str] = None
    sort: str = "popular"


class AnimeQueryBuilder:
    """Build optimized anime queries."""

    def __init__(self, repository: AnimeRepository):
        self.repository = repository

    def build(self, params: AnimeFilterParams, user=None) -> AnimeRepository.model:
        """Build filtered and sorted queryset."""
        queryset = self.repository.get_for_list_view(user)

        # Apply filters in order of selectivity
        if params.genres:
            queryset = self.repository.filter_by_genres(queryset, params.genres)

        if params.year:
            queryset = self.repository.filter_by_season(
                queryset, params.year, params.season
            )

        if params.search:
            queryset = self.repository.filter_by_search(queryset, params.search)

        if params.status:
            statuses = (
                params.status.split(",") if "," in params.status else [params.status]
            )
            queryset = queryset.filter(status__in=statuses)

        if params.anime_type:
            types = (
                params.anime_type.split(",")
                if "," in params.anime_type
                else [params.anime_type]
            )
            queryset = queryset.filter(anime_type__in=types)

        if params.studio:
            queryset = queryset.filter(studio__id=params.studio)

        if params.min_rating:
            queryset = queryset.filter(rating__gte=params.min_rating)

        if params.max_rating:
            queryset = queryset.filter(rating__lte=params.max_rating)

        return self.repository.apply_sorting(queryset, params.sort)
