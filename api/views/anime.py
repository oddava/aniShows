from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Count, Avg, Q, Prefetch, Exists, OuterRef
from django.core.cache import cache
import logging

from anime.models import Anime, Genre, Studio, UserFavorite
from users.models import UserAnimeList
from api.serializers import (
    AnimeListSerializer,
    AnimeDetailSerializer,
    GenreSerializer,
    StudioSerializer,
)

logger = logging.getLogger(__name__)


class AnimeViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Anime listing and detail with filtering, search, and sorting.
    """

    lookup_field = "slug"

    def get_queryset(self):
        queryset = Anime.objects.select_related("studio").prefetch_related("genres")

        # Prefetch user-specific data to avoid N+1 queries in serializers
        user = self.request.user
        if user.is_authenticated:
            # Annotate is_favorite as boolean (avoids query per anime)
            queryset = queryset.annotate(
                _is_favorite=Exists(
                    UserFavorite.objects.filter(user=user, anime=OuterRef("pk"))
                )
            )
            # Prefetch user's list entries for these anime
            queryset = queryset.prefetch_related(
                Prefetch(
                    "user_lists",
                    queryset=UserAnimeList.objects.filter(user=user),
                    to_attr="_user_list_entries",
                )
            )

        # Annotate with counts
        queryset = queryset.annotate(
            review_count=Count("reviews", distinct=True),
            avg_rating=Avg("reviews__rating"),
            favorite_count=Count("favorites", distinct=True),
        )

        if self.action != "list":
            return queryset.order_by(
                "-id"
            )  # Ensure stable ordering if needed, or default

        # Search
        search = self.request.query_params.get("q")
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(title_jp__icontains=search)
                | Q(synopsis__icontains=search)
            )

        # Filter by genre
        genres = []
        # Handle ?genre=action&genre=romance
        params = self.request.query_params.getlist("genre")
        for param in params:
            if param == "all":
                continue
            # Handle ?genre=action,romance
            if "," in param:
                genres.extend(param.split(","))
            else:
                genres.append(param)

        if genres:
            # Filter for anime that match ALL selected genres (AND logic)
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)

        # Filter by status
        anime_status = self.request.query_params.get("status")
        if anime_status:
            if "," in anime_status:
                queryset = queryset.filter(status__in=anime_status.split(","))
            else:
                queryset = queryset.filter(status=anime_status)

        # Filter by type
        anime_type = self.request.query_params.get("type")
        if anime_type:
            if "," in anime_type:
                queryset = queryset.filter(anime_type__in=anime_type.split(","))
            else:
                queryset = queryset.filter(anime_type=anime_type)

        # Filter by studio
        studio = self.request.query_params.get("studio")
        if studio:
            queryset = queryset.filter(studio__id=studio)

        # Filter by rating range
        min_rating = self.request.query_params.get("min_rating")
        max_rating = self.request.query_params.get("max_rating")
        if min_rating:
            queryset = queryset.filter(rating__gte=float(min_rating))
        if max_rating:
            queryset = queryset.filter(rating__lte=float(max_rating))

        # Filter by season and year
        season = self.request.query_params.get("season")
        year = self.request.query_params.get("year")
        if year:
            try:
                year_int = int(year)
                # Season date ranges
                season_ranges = {
                    "winter": [(year_int, 1, 1), (year_int, 3, 31)],
                    "spring": [(year_int, 4, 1), (year_int, 6, 30)],
                    "summer": [(year_int, 7, 1), (year_int, 9, 30)],
                    "fall": [(year_int, 10, 1), (year_int, 12, 31)],
                }
                if season and season.lower() in season_ranges:
                    start, end = season_ranges[season.lower()]
                    from datetime import date

                    queryset = queryset.filter(
                        release_date__gte=date(*start), release_date__lte=date(*end)
                    )
                else:
                    # Just filter by year
                    queryset = queryset.filter(release_date__year=year_int)
            except ValueError:
                pass

        # Sorting
        sort = self.request.query_params.get("sort", "popular")
        sort_mapping = {
            "popular": "popularity_rank",  # Use AniList popularity ranking (lower = more popular)
            "rating": "site_rank",
            "newest": "-release_date",
            "title": "title",
            "upcoming": "-member_count",  # Most anticipated (by member count)
            "trending": "trending_rank",
        }

        sort_field = sort_mapping.get(sort, "popularity_rank")

        # logical fixes for specific sorts:
        # Exclude upcoming (0 episodes) from rating and newest sorts to prevent them from hitting top
        if sort == "rating":
            queryset = queryset.filter(site_rank__isnull=False, member_count__gt=200000)
        elif sort == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort == "upcoming":
            # Show only upcoming anime, sorted by nearest release date
            queryset = queryset.filter(status="Upcoming")
        elif sort == "popular":
            # For popular sort, filter out anime without popularity_rank so they don't clutter results
            # BUT: when filtering by season/year, include all anime so seasonal views work correctly
            if not season and not year:
                queryset = queryset.filter(popularity_rank__isnull=False)
            else:
                # For seasonal views, sort by member_count (descending) which is a better
                # indicator of popularity - more members = more popular
                # This ensures popular anime like Frieren appear first even if they
                # don't have a popularity_rank set yet
                from django.db.models import F
                from django.db.models.functions import Coalesce

                queryset = queryset.annotate(member_sort=Coalesce(F("member_count"), 0))
                sort_field = "-member_sort"  # Descending - higher member count first
        elif sort == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        # Add ID as tie-breaker for stable pagination
        queryset = queryset.order_by(sort_field, "-id")

        return queryset.distinct()

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AnimeDetailSerializer
        return AnimeListSerializer

    @action(detail=False, methods=["get"])
    def trending(self, request):
        """Get trending anime (most favorited recently)"""
        # Cache for 15 minutes
        cache_key = "anime_trending"
        data = cache.get(cache_key)

        if not data:
            queryset = (
                self.get_queryset()
                .filter(trending_rank__isnull=False)
                .order_by("trending_rank")[:12]
            )
            serializer = AnimeListSerializer(
                queryset, many=True, context={"request": request}
            )
            data = serializer.data
            cache.set(cache_key, data, 60 * 15)

        return Response(data)

    @action(detail=False, methods=["get"])
    def top_rated(self, request):
        """Get top rated anime"""
        # Cache for 15 minutes
        cache_key = "anime_top_rated"
        data = cache.get(cache_key)

        if not data:
            queryset = Anime.objects.select_related("studio").prefetch_related("genres")
            queryset = queryset.filter(rating__isnull=False).order_by("-rating")[:12]
            serializer = AnimeListSerializer(
                queryset, many=True, context={"request": request}
            )
            data = serializer.data
            cache.set(cache_key, data, 60 * 15)

        return Response(data)

    @action(detail=True, methods=["get"])
    def reviews(self, request, slug=None):
        """Get reviews for a specific anime"""
        from anime.models import Review
        from api.serializers import ReviewSerializer

        anime = self.get_object()
        reviews = Review.objects.filter(anime=anime).select_related("user")
        serializer = ReviewSerializer(reviews, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def related(self, request, slug=None):
        """Get related anime based on genres"""
        anime = self.get_object()
        genre_ids = anime.genres.values_list("id", flat=True)
        related = Anime.objects.filter(genres__in=genre_ids).exclude(id=anime.id)
        related = related.annotate(shared_genres=Count("genres")).order_by(
            "-shared_genres"
        )[:8]
        serializer = AnimeListSerializer(
            related, many=True, context={"request": request}
        )
        return Response(serializer.data)


class GenreViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Genre.objects.all().order_by("name")
    serializer_class = GenreSerializer
    pagination_class = None


class StudioViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Studio.objects.all().order_by("name")
    serializer_class = StudioSerializer
    pagination_class = None
