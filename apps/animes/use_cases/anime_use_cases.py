"""
Use cases for anime operations.

This module contains business logic for anime-related operations,
following the Clean Architecture pattern.
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from django.db.models import QuerySet

from apps.animes.models import Anime
from apps.animes.repositories.anime_repository import AnimeRepository


@dataclass
class AnimeListResult:
    """Result of anime listing operation."""

    anime_list: List[Dict[str, Any]]
    total_count: int
    filters_applied: Dict[str, Any]
    page: int
    page_size: int


class ListAnimeUseCase:
    """
    Orchestrates anime listing with filtering, sorting, and pagination.

    This use case encapsulates the business logic for listing anime,
    keeping the view layer thin and focused on HTTP concerns.
    """

    def __init__(self, anime_repository: Optional[AnimeRepository] = None):
        self.anime_repo = anime_repository or AnimeRepository()

    def execute(
        self,
        filters: Dict[str, Any],
        user_id: Optional[int] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> AnimeListResult:
        """
        Execute the anime listing operation.

        Args:
            filters: Query parameters (search, genres, status, year, season, sort)
            user_id: Current user ID for personalization (optional)
            page: Pagination page number (1-indexed)
            page_size: Number of items per page

        Returns:
            AnimeListResult containing the paginated results and metadata
        """
        # Build base queryset
        queryset = self.anime_repo.get_base_queryset()

        # Apply filters
        queryset = self._apply_filters(queryset, filters)

        # Get total count before pagination
        total_count = queryset.count()

        # Apply sorting
        queryset = self._apply_sorting(queryset, filters.get("sort", "popular"))

        # Apply pagination
        offset = (page - 1) * page_size
        paginated_queryset = queryset[offset : offset + page_size]

        # Serialize results
        anime_list = [
            self._serialize_anime(anime, user_id) for anime in paginated_queryset
        ]

        return AnimeListResult(
            anime_list=anime_list,
            total_count=total_count,
            filters_applied=self._extract_applied_filters(filters),
            page=page,
            page_size=page_size,
        )

    def _apply_filters(self, queryset: QuerySet, filters: Dict[str, Any]) -> QuerySet:
        """Apply all filters to the queryset."""
        # Search filter
        if search := filters.get("search"):
            queryset = self.anime_repo.filter_by_search(queryset, search)

        # Genre filter
        if genres := filters.get("genres"):
            if isinstance(genres, str):
                genres = genres.split(",")
            queryset = self.anime_repo.filter_by_genres(queryset, genres)

        # Status filter
        if status := filters.get("status"):
            queryset = queryset.filter(status__iexact=status)

        # Type filter
        if anime_type := filters.get("type"):
            queryset = queryset.filter(anime_type__iexact=anime_type)

        # Year filter
        if year := filters.get("year"):
            try:
                year = int(year)
                queryset = queryset.filter(release_date__year=year)
            except (ValueError, TypeError):
                pass

        # Season filter
        if season := filters.get("season"):
            queryset = self.anime_repo.filter_by_season(queryset, season)

        return queryset

    def _apply_sorting(self, queryset: QuerySet, sort: str) -> QuerySet:
        """Apply sorting to the queryset."""
        sort_mapping = {
            "popular": "-member_count",
            "rating": "-rating",
            "newest": "-release_date",
            "title": "title",
            "trending": "trending_rank",
        }

        order_by = sort_mapping.get(sort, "-member_count")

        # Handle nulls in trending rank
        if sort == "trending":
            return queryset.filter(trending_rank__isnull=False).order_by(order_by)

        return queryset.order_by(order_by)

    def _serialize_anime(self, anime: Anime, user_id: Optional[int]) -> Dict[str, Any]:
        """Convert anime model to API response format."""
        data = {
            "id": anime.id,
            "title": anime.title,
            "slug": anime.slug,
            "title_jp": anime.title_jp,
            "synopsis": anime.synopsis[:200] + "..."
            if len(anime.synopsis) > 200
            else anime.synopsis,
            "anime_type": anime.anime_type,
            "status": anime.status,
            "episode_count": anime.episode_count,
            "rating": float(anime.rating) if anime.rating else None,
            "member_count": anime.member_count,
            "cover_image": self._get_image_url(anime.cover_image),
            "banner_image": self._get_image_url(anime.banner_image),
            "release_date": anime.release_date.isoformat()
            if anime.release_date
            else None,
            "genres": [
                {"id": g.id, "name": g.name, "slug": g.slug}
                for g in anime.genres.all()[:3]
            ],
            "studio": {"id": anime.studio.id, "name": anime.studio.name}
            if anime.studio
            else None,
        }

        # Add user-specific data if user_id provided
        if user_id:
            data["is_favorite"] = self._check_is_favorite(anime.id, user_id)
            data["user_list_status"] = self._get_user_list_status(anime.id, user_id)

        return data

    def _get_image_url(self, image_field) -> Optional[str]:
        """Get URL for image field."""
        if image_field:
            return image_field.url
        return None

    def _check_is_favorite(self, anime_id: int, user_id: int) -> bool:
        """Check if anime is in user's favorites."""
        from apps.animes.models import UserFavorite

        return UserFavorite.objects.filter(user_id=user_id, anime_id=anime_id).exists()

    def _get_user_list_status(self, anime_id: int, user_id: int) -> Optional[str]:
        """Get user's list status for anime."""
        from apps.users.models import UserAnimeList

        try:
            entry = UserAnimeList.objects.get(user_id=user_id, anime_id=anime_id)
            return entry.status
        except UserAnimeList.DoesNotExist:
            return None

    def _extract_applied_filters(self, filters: Dict[str, Any]) -> Dict[str, Any]:
        """Extract only the filters that were actually applied."""
        return {
            k: v
            for k, v in filters.items()
            if v
            and k in ["search", "genres", "status", "type", "year", "season", "sort"]
        }


class GetTrendingAnimeUseCase:
    """Get trending anime for homepage."""

    def __init__(self, anime_repository: Optional[AnimeRepository] = None):
        self.anime_repo = anime_repository or AnimeRepository()

    def execute(self, limit: int = 12) -> List[Dict[str, Any]]:
        """Get trending anime ordered by trending rank."""
        queryset = (
            self.anime_repo.get_base_queryset()
            .filter(trending_rank__isnull=False)
            .order_by("trending_rank")[:limit]
        )

        return [
            {
                "id": anime.id,
                "title": anime.title,
                "slug": anime.slug,
                "cover_image": anime.cover_image.url if anime.cover_image else None,
                "rating": float(anime.rating) if anime.rating else None,
                "status": anime.status,
            }
            for anime in queryset
        ]


class GetSeasonalAnimeUseCase:
    """Get current season anime."""

    def __init__(self, anime_repository: Optional[AnimeRepository] = None):
        self.anime_repo = anime_repository or AnimeRepository()

    def execute(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get current season anime."""
        from datetime import datetime

        now = datetime.now()
        year = now.year
        month = now.month

        # Determine season
        if month in [1, 2, 3]:
            season = "winter"
        elif month in [4, 5, 6]:
            season = "spring"
        elif month in [7, 8, 9]:
            season = "summer"
        else:
            season = "fall"

        queryset = self.anime_repo.get_base_queryset()
        queryset = self.anime_repo.filter_by_season(queryset, season)
        queryset = queryset.filter(release_date__year=year)
        queryset = queryset.order_by("-member_count")[:limit]

        return [
            {
                "id": anime.id,
                "title": anime.title,
                "slug": anime.slug,
                "cover_image": anime.cover_image.url if anime.cover_image else None,
                "rating": float(anime.rating) if anime.rating else None,
                "episode_count": anime.episode_count,
            }
            for anime in queryset
        ]
