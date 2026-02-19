from typing import Optional, List, Dict, Any
from django.db.models import QuerySet, Count, Avg, Q, Prefetch, Exists, OuterRef, F
from django.db.models.functions import Coalesce
from django.contrib.auth.models import User
from datetime import date

from apps.animes.models import Anime, Genre, Studio, UserFavorite
from apps.users.models import UserAnimeList


class AnimeRepository:
    """
    Repository pattern for Anime data access.
    Centralizes query logic and enables easier testing/mocking.
    """

    def __init__(self):
        self.model = Anime

    def get_base_queryset(self) -> QuerySet:
        """Get base queryset with common optimizations."""
        return self.model.objects.select_related("studio").prefetch_related("genres")

    def get_for_list_view(self, user: Optional[User] = None) -> QuerySet:
        """Get queryset optimized for list views with user annotations."""
        queryset = self.get_base_queryset()

        # Annotate with review stats
        queryset = queryset.annotate(
            review_count=Count("reviews", distinct=True),
            avg_rating=Avg("reviews__rating"),
            favorite_count=Count("favorites", distinct=True),
        )

        # Add user-specific annotations if authenticated
        if user and user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(
                    UserFavorite.objects.filter(user=user, anime=OuterRef("pk"))
                )
            ).prefetch_related(
                Prefetch(
                    "user_lists",
                    queryset=UserAnimeList.objects.filter(user=user),
                    to_attr="_user_list_entries",
                )
            )

        return queryset

    def filter_by_search(self, queryset: QuerySet, search: str) -> QuerySet:
        """Apply search filter."""
        return queryset.filter(
            Q(title__icontains=search)
            | Q(title_jp__icontains=search)
            | Q(synopsis__icontains=search)
        )

    def filter_by_genres(self, queryset: QuerySet, genres: List[str]) -> QuerySet:
        """Filter by genres (AND logic)."""
        for genre in genres:
            queryset = queryset.filter(genres__slug=genre)
        return queryset

    def filter_by_season(
        self, queryset: QuerySet, year: int, season: Optional[str] = None
    ) -> QuerySet:
        """Filter by season/year."""
        season_ranges = {
            "winter": ((year, 1, 1), (year, 3, 31)),
            "spring": ((year, 4, 1), (year, 6, 30)),
            "summer": ((year, 7, 1), (year, 9, 30)),
            "fall": ((year, 10, 1), (year, 12, 31)),
        }

        if season and season.lower() in season_ranges:
            start, end = season_ranges[season.lower()]
            return queryset.filter(
                release_date__gte=date(*start), release_date__lte=date(*end)
            )

        return queryset.filter(release_date__year=year)

    def apply_sorting(self, queryset: QuerySet, sort: str) -> QuerySet:
        """Apply sorting with special case handling."""
        sort_mapping = {
            "popular": "popularity_rank",
            "rating": "site_rank",
            "newest": "-release_date",
            "title": "title",
            "upcoming": "-member_count",
            "trending": "trending_rank",
        }

        sort_field = sort_mapping.get(sort, "popularity_rank")

        # Apply filters for specific sorts
        if sort == "rating":
            queryset = queryset.filter(site_rank__isnull=False, member_count__gt=200000)
        elif sort == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort == "upcoming":
            queryset = queryset.filter(status="Upcoming")
        elif sort == "popular":
            queryset = queryset.filter(popularity_rank__isnull=False)
        elif sort == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        return queryset.order_by(sort_field, "-id").distinct()

    def get_trending(self, limit: int = 12) -> QuerySet:
        """Get trending anime."""
        return (
            self.get_base_queryset()
            .filter(trending_rank__isnull=False)
            .order_by("trending_rank")[:limit]
        )

    def get_top_rated(self, limit: int = 12) -> QuerySet:
        """Get top rated anime."""
        return (
            self.get_base_queryset()
            .filter(rating__isnull=False)
            .order_by("-rating")[:limit]
        )

    def get_related(self, anime: Anime, limit: int = 8) -> QuerySet:
        """Get related anime based on genres - optimized with subquery."""
        from django.db.models import Subquery

        # Use subquery to get genre IDs directly in the filter
        # This reduces the query from 2 to 1
        return (
            Anime.objects.filter(genres__id__in=Subquery(anime.genres.values("id")))
            .exclude(id=anime.id)
            .select_related("studio")
            .prefetch_related("genres")
            .annotate(shared_genres=Count("genres", distinct=True))
            .order_by("-shared_genres")[:limit]
        )


class GenreRepository:
    """Repository for Genre data access."""

    def __init__(self):
        self.model = Genre

    def get_all(self) -> QuerySet:
        """Get all genres ordered by name."""
        return self.model.objects.all().order_by("name")


class StudioRepository:
    """Repository for Studio data access."""

    def __init__(self):
        self.model = Studio

    def get_all(self) -> QuerySet:
        """Get all studios ordered by name."""
        return self.model.objects.all().order_by("name")
