import hashlib
import json
from datetime import date
from urllib.parse import urlparse

from django.core.cache import cache
from django.db.models import Avg, Count, Exists, F, OuterRef, Prefetch, Q
from django.db.models.functions import Coalesce
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Genre,
    Staff,
    Studio,
    UserFavorite,
)
from apps.animes.serializers import (
    AnimeCharacterSerializer,
    AnimeDetailSerializer,
    AnimeListSerializer,
    AnimeStaffSerializer,
    GenreSerializer,
    StudioSerializer,
)
from apps.animes.services.franchise_import import FranchiseImportError, FranchiseImportService
from apps.shared.logger import logger
from apps.shared.pagination import StandardPagination
from apps.users.models import UserAnimeList

VALID_STATUSES = {"airing", "finished", "upcoming", "not_yet_aired"}
VALID_TYPES = {"tv", "movie", "ova", "ona", "special", "music"}
VALID_SEASONS = {"winter", "spring", "summer", "fall"}
VALID_SORT_FIELDS = {"popular", "rating", "newest", "title", "upcoming", "trending"}
MAX_RATING = 10.0
MIN_RATING = 0.0


class AnimeViewSet(ReadOnlyModelViewSet):
    pagination_class = StandardPagination
    lookup_field = "slug"
    franchise_import_service = FranchiseImportService()

    _LIST_FIELDS = (
        "id",
        "title",
        "title_jp",
        "slug",
        "cover_image",
        "cover_image_external_url",
        "banner_image",
        "banner_image_external_url",
        "rating",
        "episode_count",
        "anime_type",
        "status",
        "synopsis",
        "release_date",
        "next_airing_episode",
        "next_airing_date",
        "studio_id",
        "popularity_rank",
        "trending_rank",
        "member_count",
        "site_rank",
    )
    _INTERNAL_MEDIA_HOSTS = {"localhost", "127.0.0.1", "minio", "web"}
    _MEDIA_URL_FIELDS = (
        "cover_image",
        "cover_image_small",
        "cover_image_medium",
        "cover_image_large",
        "banner_image",
        "banner_image_small",
        "banner_image_medium",
        "banner_image_large",
    )

    def get_queryset(self):
        is_list = self.action == "list"

        queryset = Anime.objects.select_related("studio")

        if is_list:
            queryset = queryset.only(*self._LIST_FIELDS, "studio__id", "studio__name")
            queryset = queryset.prefetch_related("genres")
        else:
            queryset = queryset.prefetch_related(
                "genres",
                "theme_songs",
            ).annotate(
                character_count=Count("cast", distinct=True),
                staff_count=Count("production_staff", distinct=True),
            )

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(UserFavorite.objects.filter(user=user, anime=OuterRef("pk")))
            )
            queryset = queryset.prefetch_related(
                Prefetch(
                    "user_lists",
                    queryset=UserAnimeList.objects.filter(user=user),
                    to_attr="_user_list_entries",
                )
            )

        if not is_list:
            queryset = queryset.annotate(
                review_count=Count("reviews", distinct=True),
                avg_rating=Avg("reviews__rating"),
            )
            return queryset.order_by("-id")

        needs_distinct = False

        search = self.request.query_params.get("q")
        if search:
            search_words = search.strip().split()
            if len(search_words) == 1:
                queryset = queryset.filter(
                    Q(title__icontains=search)
                    | Q(title_jp__icontains=search)
                    | Q(synopsis__icontains=search)
                )
            else:
                for word in search_words:
                    if len(word) >= 2:
                        queryset = queryset.filter(
                            Q(title__icontains=word) | Q(title_jp__icontains=word)
                        )

        genres = []
        params = self.request.query_params.getlist("genre")
        for param in params:
            if param == "all":
                continue
            if "," in param:
                genres.extend(param.split(","))
            else:
                genres.append(param)

        if genres:
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)
            needs_distinct = True

        anime_status = self.request.query_params.get("status")
        if anime_status:
            if "," in anime_status:
                statuses = [s.strip().lower() for s in anime_status.split(",")]
                valid_statuses = [s for s in statuses if s in VALID_STATUSES]
                if valid_statuses:
                    status_q = Q()
                    for s in valid_statuses:
                        status_q |= Q(status__iexact=s)
                    queryset = queryset.filter(status_q)
            else:
                status_clean = anime_status.strip().lower()
                if status_clean in VALID_STATUSES:
                    queryset = queryset.filter(status__iexact=status_clean)

        anime_type = self.request.query_params.get("type")
        if anime_type:
            if "," in anime_type:
                types_list = [t.strip().lower() for t in anime_type.split(",")]
                valid_types = [t for t in types_list if t in VALID_TYPES]
                if valid_types:
                    queryset = queryset.filter(anime_type__in=valid_types)
            else:
                type_clean = anime_type.strip().lower()
                if type_clean in VALID_TYPES:
                    queryset = queryset.filter(anime_type=type_clean)

        studio = self.request.query_params.get("studio")
        if studio:
            try:
                studio_id = int(studio)
                if studio_id > 0:
                    queryset = queryset.filter(studio__id=studio_id)
            except (ValueError, TypeError):
                pass

        min_rating = self.request.query_params.get("min_rating")
        max_rating = self.request.query_params.get("max_rating")
        if min_rating:
            try:
                min_rating_val = float(min_rating)
                if MIN_RATING <= min_rating_val <= MAX_RATING:
                    queryset = queryset.filter(rating__gte=min_rating_val)
            except (ValueError, TypeError):
                pass
        if max_rating:
            try:
                max_rating_val = float(max_rating)
                if MIN_RATING <= max_rating_val <= MAX_RATING:
                    queryset = queryset.filter(rating__lte=max_rating_val)
            except (ValueError, TypeError):
                pass

        season = self.request.query_params.get("season")
        year = self.request.query_params.get("year")
        if year:
            try:
                year_int = int(year)
                if 1980 <= year_int <= 2050:
                    season_ranges = {
                        "winter": [(year_int, 1, 1), (year_int, 3, 31)],
                        "spring": [(year_int, 4, 1), (year_int, 6, 30)],
                        "summer": [(year_int, 7, 1), (year_int, 9, 30)],
                        "fall": [(year_int, 10, 1), (year_int, 12, 31)],
                    }
                    season_clean = season.strip().lower() if season else None
                    if season_clean and season_clean in VALID_SEASONS:
                        start, end = season_ranges[season_clean]
                        queryset = queryset.filter(
                            release_date__gte=date(*start), release_date__lte=date(*end)
                        )
                    else:
                        queryset = queryset.filter(release_date__year=year_int)
            except (ValueError, TypeError):
                pass

        sort = self.request.query_params.get("sort", "popular")
        sort_clean = sort.strip().lower()
        sort_mapping = {
            "popular": "popularity_rank",
            "rating": "-rating",
            "newest": "-release_date",
            "title": "title",
            "upcoming": "-member_count",
            "trending": "trending_rank",
        }
        sort_field = sort_mapping.get(sort_clean, "popularity_rank")

        # Exclude upcoming (0 episodes) from rating and newest sorts to prevent them from hitting top
        if sort == "rating":
            queryset = queryset.filter(rating__isnull=False, member_count__gt=200000)
        elif sort == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort == "upcoming":
            queryset = queryset.filter(status="Upcoming")
        elif sort == "popular":
            if not season and not year and not search:
                queryset = queryset.filter(popularity_rank__isnull=False)
            else:
                queryset = queryset.annotate(member_sort=Coalesce(F("member_count"), 0))
                sort_field = "-member_sort"
        elif sort == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        # Add ID as tie-breaker for stable pagination
        queryset = queryset.order_by(sort_field, "-id")

        if needs_distinct:
            queryset = queryset.distinct()

        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AnimeDetailSerializer
        return AnimeListSerializer

    def retrieve(self, request, *args, **kwargs):
        """Optimized retrieve with base data caching and user data injection."""
        slug = kwargs.get("slug")
        is_auth = request.user.is_authenticated

        # Cache the BASE data (same for all users)
        base_cache_key = f"anime_detail_base:{slug}"
        cached_base = cache.get(base_cache_key)
        needs_refresh = not cached_base
        if cached_base:
            data = cached_base.copy()
            # Self-heal stale cache entries that were stored before image refs existed.
            if not self._has_cover_media(data) or self._item_has_internal_media_urls(
                data, request
            ):
                needs_refresh = True
                cache.delete(base_cache_key)

        if needs_refresh:
            try:
                # Use a lightweight queryset for base data
                instance = self.get_queryset().get(slug=slug)
                serializer = self.get_serializer(instance)
                data = serializer.data
                # Avoid long-lived cache for still-incomplete media payloads.
                ttl = 3600 if self._has_cover_media(data) else 60
                cache.set(base_cache_key, data, ttl)
            except Anime.DoesNotExist:
                return Response({"error": "Anime not found"}, status=status.HTTP_404_NOT_FOUND)
            except Exception as e:
                logger.error(f"Error retrieving anime {slug}: {e!s}")
                return Response(
                    {"error": "Internal server error"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        # Inject user-specific data if authenticated
        if is_auth:
            user = request.user
            # Get latest user status and favorite info
            # These are small queries that are fast with indexes
            data["is_favorite"] = UserFavorite.objects.filter(user=user, anime_id=data["id"]).exists()

            try:
                from apps.users.models import UserAnimeList

                entry = UserAnimeList.objects.filter(user=user, anime_id=data["id"]).first()
                if entry:
                    data["user_list_status"] = {
                        "id": entry.id,
                        "status": entry.status,
                        "score": entry.score,
                        "episodes_watched": entry.episodes_watched,
                        "notes": entry.notes,
                        "started_at": str(entry.started_at) if entry.started_at else None,
                        "finished_at": str(entry.finished_at) if entry.finished_at else None,
                        "is_rewatching": entry.is_rewatching,
                        "progress": (entry.episodes_watched / data["episode_count"] * 100)
                        if data.get("episode_count") and data["episode_count"] > 0
                        else 0,
                    }
                else:
                    data["user_list_status"] = None
            except Exception as e:
                logger.warning(f"Error injecting user status for anime {slug}: {e}")

        return Response(data)

    @staticmethod
    def _has_cover_media(data: dict) -> bool:
        return bool(
            data.get("cover_image_large")
            or data.get("cover_image_medium")
            or data.get("cover_image_small")
            or data.get("cover_image")
        )

    @classmethod
    def _item_has_internal_media_urls(cls, item: dict, request) -> bool:
        """Detect stale cached payloads that still point at internal media hosts."""
        if not isinstance(item, dict):
            return False

        for field in cls._MEDIA_URL_FIELDS:
            value = item.get(field)
            if not isinstance(value, str) or not value.startswith(("http://", "https://")):
                continue
            host = (urlparse(value).hostname or "").lower()
            if host in cls._INTERNAL_MEDIA_HOSTS:
                return True
        return False

    @classmethod
    def _payload_has_internal_media_urls(cls, payload, request) -> bool:
        if isinstance(payload, list):
            return any(cls._item_has_internal_media_urls(item, request) for item in payload)

        if isinstance(payload, dict):
            results = payload.get("results")
            if isinstance(results, list):
                return any(cls._item_has_internal_media_urls(item, request) for item in results)
            return cls._item_has_internal_media_urls(payload, request)

        return False

    def list(self, request, *args, **kwargs):
        """Override to add caching for anime list endpoint"""
        if request.user.is_authenticated:
            return super().list(request, *args, **kwargs)

        params = dict(request.query_params)
        param_string = json.dumps(sorted(params.items()), separators=(",", ":"))
        cache_key_hash = hashlib.sha256(param_string.encode()).hexdigest()
        cache_key = f"anime_list:{cache_key_hash}"

        cached_data = cache.get(cache_key)
        if cached_data and not self._payload_has_internal_media_urls(cached_data, request):
            return Response(cached_data)
        if cached_data:
            cache.delete(cache_key)

        response = super().list(request, *args, **kwargs)

        cache.set(cache_key, response.data, 300)

        return response

    def _get_cached_shelf(self, request, cache_key, queryset_fn):
        """Shared helper for trending/top_rated shelves."""
        data = cache.get(cache_key)

        if data and self._payload_has_internal_media_urls(data, request):
            cache.delete(cache_key)
            data = None

        if not data:
            queryset = queryset_fn(
                Anime.objects.select_related("studio").prefetch_related("genres")
            )
            serializer = AnimeListSerializer(queryset, many=True, context={"request": request})
            data = serializer.data
            cache.set(cache_key, data, 60 * 10)

        if request.user.is_authenticated and data:
            anime_ids = [item["id"] for item in data]
            favorite_ids = set(
                UserFavorite.objects.filter(user=request.user, anime_id__in=anime_ids).values_list(
                    "anime_id", flat=True
                )
            )
            list_entries = {
                entry.anime_id: entry
                for entry in UserAnimeList.objects.filter(user=request.user, anime_id__in=anime_ids)
            }
            data = [
                {
                    **item,
                    "is_favorite": item["id"] in favorite_ids,
                    "user_list_status": {
                        "id": entry.id,
                        "status": entry.status,
                        "score": entry.score,
                        "episodes_watched": entry.episodes_watched,
                        "notes": entry.notes,
                        "started_at": str(entry.started_at) if entry.started_at else None,
                        "finished_at": str(entry.finished_at) if entry.finished_at else None,
                        "is_rewatching": entry.is_rewatching,
                        "progress": (
                            entry.episodes_watched / item["episode_count"] * 100
                            if item.get("episode_count") and item["episode_count"] > 0
                            else 0
                        ),
                    }
                    if (entry := list_entries.get(item["id"]))
                    else None,
                }
                for item in data
            ]

        return Response(data)

    @action(detail=False, methods=["get"])
    def trending(self, request):
        """Get trending anime (most favorited recently)"""
        return self._get_cached_shelf(
            request,
            "anime_trending",
            lambda qs: qs.filter(trending_rank__isnull=False).order_by("trending_rank")[:12],
        )

    @action(detail=False, methods=["get"])
    def top_rated(self, request):
        """Get top rated anime"""
        return self._get_cached_shelf(
            request,
            "anime_top_rated",
            lambda qs: qs.filter(rating__isnull=False).order_by("-rating")[:12],
        )

    @action(detail=True, methods=["get"])
    def reviews(self, request, slug=None):
        """Get reviews for a specific anime with pagination"""
        from apps.animes.models import Review
        from apps.animes.serializers import ReviewSerializer

        anime = self.get_object()
        reviews = Review.objects.filter(anime=anime).select_related("user")

        paginator = PageNumberPagination()
        paginator.page_size = 20
        result_page = paginator.paginate_queryset(reviews, request)
        serializer = ReviewSerializer(result_page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"])
    def related(self, request, slug=None):
        """Get related anime based on genres"""
        anime = self.get_object()
        genre_ids = anime.genres.values_list("id", flat=True)
        related = (
            Anime.objects.filter(genres__in=genre_ids)
            .exclude(id=anime.id)
            .select_related("studio")
            .prefetch_related("genres")
            .annotate(shared_genres=Count("genres"))
            .order_by("-shared_genres")[:8]
        )
        serializer = AnimeListSerializer(related, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def characters(self, request, slug=None):
        """Get full characters list for this anime."""
        instance = self.get_object()
        characters = AnimeCharacter.objects.filter(anime=instance).select_related(
            "character", "voice_actor"
        )
        serializer = AnimeCharacterSerializer(characters, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def staff(self, request, slug=None):
        """Get full staff list for this anime."""
        instance = self.get_object()
        staff = AnimeStaff.objects.filter(anime=instance).select_related("staff")
        serializer = AnimeStaffSerializer(staff, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="franchise/fetch")
    def franchise_fetch(self, request):
        anilist_id = request.data.get("anilist_id")
        if not anilist_id:
            return Response(
                {"error": "anilist_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            anilist_id = int(anilist_id)
        except (ValueError, TypeError):
            return Response(
                {"error": "anilist_id must be a valid integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = self.franchise_import_service.import_from_anilist(
                anilist_id=anilist_id,
                client_ip=self._get_client_ip(request),
                source_slug=request.data.get("source_slug"),
            )
            return Response(
                {
                    "slug": result.slug,
                    "title": result.title,
                    "imported": result.imported,
                }
            )
        except FranchiseImportError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

    @staticmethod
    def _get_client_ip(request):
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

class GenreViewSet(ReadOnlyModelViewSet):
    queryset = Genre.objects.all().order_by("name")
    serializer_class = GenreSerializer
    pagination_class = None

class StudioViewSet(ReadOnlyModelViewSet):
    queryset = Studio.objects.all().order_by("name")
    serializer_class = StudioSerializer
    pagination_class = None
