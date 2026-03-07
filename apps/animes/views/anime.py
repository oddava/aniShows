from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Count, Avg, Q, Prefetch, Exists, OuterRef, F
from django.db.models.functions import Coalesce
from django.core.cache import cache
from datetime import date
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.shared.logger import logger
from apps.shared.pagination import StandardPagination

from apps.animes.models import (
    Anime,
    Genre,
    Studio,
    UserFavorite,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Staff,
)
from apps.users.models import UserAnimeList
from apps.animes.serializers import (
    AnimeListSerializer,
    AnimeDetailSerializer,
    GenreSerializer,
    StudioSerializer,
)

# Valid filter values for security
VALID_STATUSES = {"airing", "finished", "upcoming", "not_yet_aired"}
VALID_TYPES = {"tv", "movie", "ova", "ona", "special", "music"}
VALID_SEASONS = {"winter", "spring", "summer", "fall"}
VALID_SORT_FIELDS = {"popular", "rating", "newest", "title", "upcoming", "trending"}
MAX_RATING = 10.0
MIN_RATING = 0.0

import hashlib
import json

class AnimeViewSet(ReadOnlyModelViewSet):
    pagination_class = StandardPagination
    lookup_field = "slug"

    # Fields that AnimeListSerializer actually needs from the Anime table.
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
                Prefetch(
                    "cast",
                    queryset=AnimeCharacter.objects.select_related("character", "voice_actor"),
                ),
                Prefetch(
                    "production_staff",
                    queryset=AnimeStaff.objects.select_related("staff"),
                ),
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

        # ── Aggregate annotations — only for detail (list doesn't display these) ──
        if not is_list:
            queryset = queryset.annotate(
                review_count=Count("reviews", distinct=True),
                avg_rating=Avg("reviews__rating"),
            )
            return queryset.order_by("-id")

        # ──────────────────────────────────────────────────────────
        #  LIST-specific filtering & sorting below
        # ──────────────────────────────────────────────────────────
        needs_distinct = False

        # Search - split query into words for better matching
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
                # Multi-word search - each word must appear in title OR title_jp
                for word in search_words:
                    if len(word) >= 2:  # Skip very short words
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
            # Filter for anime that match ALL selected genres (AND logic)
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)
            # Multiple genre JOINs can produce duplicate rows
            needs_distinct = True

        # Filter by status - validate against whitelist (case-insensitive)
        anime_status = self.request.query_params.get("status")
        if anime_status:
            if "," in anime_status:
                statuses = [s.strip().lower() for s in anime_status.split(",")]
                # Only allow valid statuses
                valid_statuses = [s for s in statuses if s in VALID_STATUSES]
                if valid_statuses:
                    # Use iexact for case-insensitive matching with title-case DB values
                    status_q = Q()
                    for s in valid_statuses:
                        status_q |= Q(status__iexact=s)
                    queryset = queryset.filter(status_q)
            else:
                status_clean = anime_status.strip().lower()
                if status_clean in VALID_STATUSES:
                    queryset = queryset.filter(status__iexact=status_clean)

        # Filter by type - validate against whitelist
        anime_type = self.request.query_params.get("type")
        if anime_type:
            if "," in anime_type:
                types_list = [t.strip().lower() for t in anime_type.split(",")]
                # Only allow valid types
                valid_types = [t for t in types_list if t in VALID_TYPES]
                if valid_types:
                    queryset = queryset.filter(anime_type__in=valid_types)
            else:
                type_clean = anime_type.strip().lower()
                if type_clean in VALID_TYPES:
                    queryset = queryset.filter(anime_type=type_clean)

        # Filter by studio - validate as positive integer
        studio = self.request.query_params.get("studio")
        if studio:
            try:
                studio_id = int(studio)
                if studio_id > 0:
                    queryset = queryset.filter(studio__id=studio_id)
            except (ValueError, TypeError):
                # Invalid studio ID, ignore filter
                pass

        # Filter by rating range - validate numeric range
        min_rating = self.request.query_params.get("min_rating")
        max_rating = self.request.query_params.get("max_rating")
        if min_rating:
            try:
                min_rating_val = float(min_rating)
                if MIN_RATING <= min_rating_val <= MAX_RATING:
                    queryset = queryset.filter(rating__gte=min_rating_val)
            except (ValueError, TypeError):
                # Invalid rating, ignore filter
                pass
        if max_rating:
            try:
                max_rating_val = float(max_rating)
                if MIN_RATING <= max_rating_val <= MAX_RATING:
                    queryset = queryset.filter(rating__lte=max_rating_val)
            except (ValueError, TypeError):
                # Invalid rating, ignore filter
                pass

        # Filter by season and year - validate inputs
        season = self.request.query_params.get("season")
        year = self.request.query_params.get("year")
        if year:
            try:
                year_int = int(year)
                # Validate year is reasonable (1980-2050)
                if 1980 <= year_int <= 2050:
                    # Season date ranges
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
                        # Just filter by year
                        queryset = queryset.filter(release_date__year=year_int)
            except (ValueError, TypeError):
                # Invalid year, ignore filter
                pass

        # Sorting - validate against whitelist
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
        # Only use valid sort fields, default to popular if invalid
        sort_field = sort_mapping.get(sort_clean, "popularity_rank")

        # logical fixes for specific sorts:
        # Exclude upcoming (0 episodes) from rating and newest sorts to prevent them from hitting top
        if sort == "rating":
            queryset = queryset.filter(rating__isnull=False, member_count__gt=200000)
        elif sort == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort == "upcoming":
            # Show only upcoming anime, sorted by nearest release date
            queryset = queryset.filter(status="Upcoming")
        elif sort == "popular":
            # For popular sort, filter out anime without popularity_rank so they don't clutter results
            # BUT: when filtering by season/year or searching, include all anime so views work correctly
            if not season and not year and not search:
                queryset = queryset.filter(popularity_rank__isnull=False)
            else:
                # For seasonal/search views, sort by member_count (descending) which is a better
                # indicator of popularity - more members = more popular
                # This ensures popular anime like Frieren appear first even if they
                # don't have a popularity_rank set yet
                queryset = queryset.annotate(member_sort=Coalesce(F("member_count"), 0))
                sort_field = "-member_sort"  # Descending - higher member count first
        elif sort == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        # Add ID as tie-breaker for stable pagination
        queryset = queryset.order_by(sort_field, "-id")

        # Only apply DISTINCT when genre joins can produce duplicate rows
        if needs_distinct:
            queryset = queryset.distinct()

        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AnimeDetailSerializer
        return AnimeListSerializer

    def retrieve(self, request, *args, **kwargs):
        """Override to prefetch user_lists for status distribution calculation with caching"""
        slug = kwargs.get("slug")
        user_id = request.user.id if request.user.is_authenticated else "anon"
        cache_key = f"anime_detail:{slug}:{user_id}"

        # Try to get from cache first
        cached_data = cache.get(cache_key)
        if cached_data and not request.user.is_authenticated:
            return Response(cached_data)

        try:
            instance = self.get_object()
            from apps.users.models import UserAnimeList

            user_lists = UserAnimeList.objects.filter(anime=instance).only("status")
            instance._prefetched_objects_cache["user_lists"] = user_lists
            serializer = self.get_serializer(instance)
            data = serializer.data

            # Cache for 10 minutes (longer cache for better performance)
            # Only cache for anonymous users to avoid stale data for logged-in users
            if not request.user.is_authenticated:
                cache.set(cache_key, data, 600)

            return Response(data)
        except Exception as e:
            logger.error(f"Error retrieving anime {slug}: {str(e)}")
            # If cache exists, return stale data rather than 500 error
            if cached_data:
                logger.warning(f"Returning stale cache for anime {slug}")
                return Response(cached_data)
            raise

    def list(self, request, *args, **kwargs):
        """Override to add caching for anime list endpoint"""
        if request.user.is_authenticated:
            return super().list(request, *args, **kwargs)

        params = dict(request.query_params)
        # Use a deterministic, fixed-size hash for the cache key
        param_string = json.dumps(sorted(params.items()), separators=(",", ":"))
        cache_key_hash = hashlib.sha256(param_string.encode()).hexdigest()
        cache_key = f"anime_list:{cache_key_hash}"

        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data)

        response = super().list(request, *args, **kwargs)

        # Cache the response data (5 minutes for anonymous users)
        cache.set(cache_key, response.data, 300)

        return response

    def _get_cached_shelf(self, request, cache_key, queryset_fn):
        """
        Shared helper for trending/top_rated shelves.

        Caches the base anime data under a single shared key (not per-user)
        and overlays lightweight user-specific fields for authenticated users.
        This avoids 100k duplicate cache entries for identical data.
        """
        data = cache.get(cache_key)

        if not data:
            # Use a lightweight queryset — only fields needed by AnimeListSerializer
            queryset = queryset_fn(
                Anime.objects.select_related("studio").prefetch_related("genres")
            )
            serializer = AnimeListSerializer(queryset, many=True, context={"request": request})
            data = serializer.data
            cache.set(cache_key, data, 60 * 10)  # 10 min shared cache

        # Overlay user-specific fields for authenticated users
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
            # Return a new list so we don't mutate the cached data
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

    @action(detail=False, methods=["post"], url_path="franchise/fetch")
    def franchise_fetch(self, request):
        """
        Look up a franchise relation by anilist_id.
        If the anime exists locally, return its slug immediately.
        If not, fetch it from AniList synchronously, import it, and return the new slug.
        """
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

        # Check if anime already exists locally
        try:
            anime = Anime.objects.get(anilist_id=anilist_id)
            return Response({"slug": anime.slug, "title": anime.title, "imported": False})
        except Anime.DoesNotExist:
            pass

        # Rate limit: max 10 franchise fetches per minute per IP
        client_ip = self._get_client_ip(request)
        rate_key = f"franchise_fetch:{client_ip}"
        current_count = cache.get(rate_key, 0)
        if current_count >= 10:
            return Response(
                {"error": "Rate limit exceeded"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        cache.set(rate_key, current_count + 1, timeout=60)

        # Fetch from AniList using sync httpx and save to DB
        import httpx
        import re
        from django.db import IntegrityError
        from django.utils.text import slugify
        from django.utils import timezone as django_timezone
        from datetime import datetime, timezone as dt_timezone

        ANILIST_URL = "https://graphql.anilist.co/"
        MEDIA_FIELDS = """
            id
            idMal
            title { romaji english native }
            format status episodes averageScore popularity duration
            startDate { year month day }
            endDate { year month day }
            season seasonYear
            source
            genres
            studios(isMain: true) { nodes { name } }
            description
            coverImage { large extraLarge }
            bannerImage
            trailer { id site }
            rankings { rank type allTime context }
            stats { statusDistribution { status amount } }
            externalLinks { site url icon }
            nextAiringEpisode { episode airingAt }
            relations {
                edges {
                    relationType
                    node { id title { romaji english native } type format status coverImage { large } }
                }
            }
            characterPreview: characters(perPage: 10, sort: [ROLE, RELEVANCE]) {
                edges {
                    role
                    node { id name { full native } image { large } description }
                    voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                        id name { full native } image { large } description
                    }
                }
            }
            staffPreview: staff(perPage: 10, sort: [RELEVANCE, ID]) {
                edges {
                    role
                    node { id name { full native } image { large } description }
                }
            }
        """

        query = f"""
            query GetAnimeById($id: Int) {{
                Media(id: $id, type: ANIME) {{
                    {MEDIA_FIELDS}
                }}
            }}
        """

        try:
            # Synchronous AniList GraphQL request
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    ANILIST_URL,
                    json={"query": query, "variables": {"id": anilist_id}},
                    headers={"Content-Type": "application/json"},
                )

                if resp.status_code == 429:
                    logger.warning(f"AniList rate limited during franchise fetch for {anilist_id}")
                    return Response(
                        {"error": "External API rate limited, try again shortly"},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    )

                resp.raise_for_status()
                data = resp.json()

            if "errors" in data:
                logger.error(f"AniList GraphQL error for {anilist_id}: {data['errors']}")
                return Response(
                    {"error": "Could not fetch from AniList"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            media = data.get("data", {}).get("Media")
            if not media:
                logger.warning(f"No media returned from AniList for anilist_id={anilist_id}")
                return Response(
                    {"error": "Not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Parse and save to database synchronously
            from apps.animes.models import Genre, Studio

            item = media
            title_english = item.get("title", {}).get("english") or ""
            title_romaji = item.get("title", {}).get("romaji") or ""
            title_native = item.get("title", {}).get("native") or ""
            title = title_english or title_romaji

            if not title:
                return Response(
                    {"error": "Anime has no title"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            base_slug = slugify(title)

            # Check again if it was created in between (race condition guard)
            try:
                anime = Anime.objects.get(anilist_id=anilist_id)
                return Response({"slug": anime.slug, "title": anime.title, "imported": False})
            except Anime.DoesNotExist:
                pass

            # Generate unique slug
            final_slug = base_slug
            counter = 0
            while Anime.objects.filter(slug=final_slug).exists():
                counter += 1
                final_slug = f"{base_slug}-{counter}"
                if counter > 50:
                    break

            # Map format
            format_map = {
                "TV": Anime.AnimeType.tv,
                "TV_SHORT": Anime.AnimeType.tv,
                "MOVIE": Anime.AnimeType.movie,
                "OVA": Anime.AnimeType.ova,
                "ONA": Anime.AnimeType.special,
                "SPECIAL": Anime.AnimeType.special,
                "MUSIC": Anime.AnimeType.special,
            }
            anime_type = format_map.get(item.get("format", "TV"), Anime.AnimeType.tv)

            # Map status
            status_map = {
                "RELEASING": Anime.AnimeStatus.airing,
                "FINISHED": Anime.AnimeStatus.finished,
                "NOT_YET_RELEASED": Anime.AnimeStatus.upcoming,
                "CANCELLED": Anime.AnimeStatus.finished,
            }
            anime_status = status_map.get(
                item.get("status", "FINISHED"), Anime.AnimeStatus.finished
            )

            # Parse dates
            def parse_date(date_obj):
                if not date_obj or not date_obj.get("year"):
                    return None
                try:
                    return datetime(
                        date_obj["year"],
                        date_obj.get("month") or 1,
                        date_obj.get("day") or 1,
                    ).date()
                except (ValueError, TypeError):
                    return None

            start_date = parse_date(item.get("startDate", {}))
            end_date = parse_date(item.get("endDate", {}))

            avg_score = item.get("averageScore", 0)
            rating = round(avg_score / 10, 1) if avg_score else None

            description = item.get("description", "") or ""
            if description:
                description = re.sub(r"<[^>]+>", "", description).strip()

            # Source material
            source_map = {
                "ORIGINAL": "Original",
                "MANGA": "Manga",
                "LIGHT_NOVEL": "Light Novel",
                "VISUAL_NOVEL": "Visual Novel",
                "VIDEO_GAME": "Game",
                "WEB_NOVEL": "Novel",
                "NOVEL": "Novel",
                "DOUJINSHI": "Other",
                "ANIME": "Original",
                "MUSIC": "Music",
                "MIXED_MEDIA": "Mixed Media",
                "PICTURE_BOOK": "Picture Book",
                "CARD_GAME": "Card Game",
                "WEB_MANGA": "Web Manga",
                "COMIC": "Manga",
                "LIVE_ACTION": "Other",
                "MULTIMEDIA_PROJECT": "Mixed Media",
                "OTHER": "Other",
            }
            source_material = source_map.get(item.get("source"), "") if item.get("source") else ""

            # Build relations list with slug lookups
            raw_relations = [
                {
                    "id": edge["node"]["id"],
                    "type": edge["relationType"],
                    "title": edge["node"]["title"].get("english")
                    or edge["node"]["title"].get("romaji"),
                    "format": edge["node"]["format"],
                    "status": edge["node"]["status"],
                    "cover": edge["node"]["coverImage"].get("large"),
                }
                for edge in item.get("relations", {}).get("edges", [])
                if edge["node"]["type"] == "ANIME"
            ]

            # Look up slugs for related anime already in DB
            related_anilist_ids = [r["id"] for r in raw_relations if r.get("id")]
            slug_map = {}
            if related_anilist_ids:
                slug_map = dict(
                    Anime.objects.filter(anilist_id__in=related_anilist_ids).values_list(
                        "anilist_id", "slug"
                    )
                )
            for rel in raw_relations:
                rel["slug"] = slug_map.get(rel["id"])

            # Next airing
            next_airing = item.get("nextAiringEpisode")
            next_airing_episode = next_airing.get("episode") if next_airing else None
            next_airing_date = None
            if next_airing and next_airing.get("airingAt"):
                next_airing_date = django_timezone.make_aware(
                    datetime.fromtimestamp(next_airing["airingAt"]),
                    timezone=dt_timezone.utc,
                )

            # Validate source_material against model choices
            valid_sources = {c[0] for c in Anime.SourceMaterial.choices}
            if source_material not in valid_sources:
                source_material = ""

            # Grab external image URLs for immediate fallback (before Celery downloads)
            cover_url_external = (
                item.get("coverImage", {}).get("extraLarge")
                or item.get("coverImage", {}).get("large")
                or ""
            )
            banner_url_external = item.get("bannerImage") or ""

            # Handle title uniqueness: append format/year if title conflicts
            final_title = title
            if Anime.objects.filter(title=title).exists():
                year_suffix = str(start_date.year) if start_date else ""
                format_suffix = item.get("format", "")
                parts = [p for p in [format_suffix, year_suffix] if p]
                if parts:
                    final_title = f"{title} ({' '.join(parts)})"
                else:
                    final_title = f"{title} ({anilist_id})"

            # Handle mal_id uniqueness: set to None if already taken
            incoming_mal_id = item.get("idMal")
            if incoming_mal_id and Anime.objects.filter(mal_id=incoming_mal_id).exists():
                incoming_mal_id = None

            try:
                anime = Anime.objects.create(
                    title=final_title,
                    title_jp=title_native,
                    slug=final_slug,
                    synopsis=description or "No description available.",
                    anime_type=anime_type,
                    status=anime_status,
                    episode_count=item.get("episodes") or 0,
                    duration_minutes=item.get("duration") or 24,
                    member_count=item.get("popularity") or 0,
                    release_date=start_date,
                    end_date=end_date,
                    rating=rating,
                    meta_description=(description[:157] + "...")
                    if description and len(description) > 160
                    else (description or ""),
                    site_rank=next(
                        (
                            r["rank"]
                            for r in item.get("rankings", [])
                            if r["allTime"] and r["type"] == "RATED"
                        ),
                        None,
                    ),
                    popularity_rank=next(
                        (
                            r["rank"]
                            for r in item.get("rankings", [])
                            if r["allTime"] and r["type"] == "POPULAR"
                        ),
                        None,
                    ),
                    status_distribution={
                        s["status"]: s["amount"]
                        for s in item.get("stats", {}).get("statusDistribution", [])
                    },
                    external_links=item.get("externalLinks", []),
                    relations=raw_relations,
                    next_airing_episode=next_airing_episode,
                    next_airing_date=next_airing_date,
                    source_material=source_material,
                    season=item.get("season") or "",
                    season_year=item.get("seasonYear"),
                    anilist_id=item.get("id"),
                    mal_id=incoming_mal_id,
                    cover_image_external_url=cover_url_external,
                    banner_image_external_url=banner_url_external,
                )
            except IntegrityError:
                # Race condition: another request created this anime between our checks
                try:
                    anime = Anime.objects.get(anilist_id=anilist_id)
                    return Response({"slug": anime.slug, "title": anime.title, "imported": False})
                except Anime.DoesNotExist:
                    return Response(
                        {"error": "Import failed due to conflict"},
                        status=status.HTTP_409_CONFLICT,
                    )

            logger.info(
                f"Franchise fetch: created anime '{title}' (anilist_id={anilist_id}, slug={final_slug})"
            )

            # Handle genres
            for genre_name in item.get("genres", []):
                genre, _ = Genre.objects.get_or_create(
                    name=genre_name, defaults={"slug": slugify(genre_name)}
                )
                anime.genres.add(genre)

            # Handle studio
            studios = item.get("studios", {}).get("nodes", [])
            if studios:
                studio_name = studios[0].get("name")
                if studio_name:
                    studio_obj, _ = Studio.objects.get_or_create(name=studio_name)
                    anime.studio = studio_obj
                    anime.save(update_fields=["studio"])

            # Queue background image fetch
            cover_url = item.get("coverImage", {}).get("extraLarge") or item.get(
                "coverImage", {}
            ).get("large")
            banner_url = item.get("bannerImage")
            mal_id = item.get("idMal")

            if cover_url or banner_url or mal_id:
                try:
                    from apps.animes.tasks.images import fetch_anime_images

                    fetch_anime_images.delay(
                        anime_id=anime.id,
                        cover_url=cover_url,
                        banner_url=banner_url,
                        mal_id=mal_id,
                    )
                except Exception as img_err:
                    logger.warning(f"Failed to queue image fetch for {title}: {img_err}")

            # Handle trailer
            trailer = item.get("trailer")
            if trailer and trailer.get("id") and trailer.get("site"):
                trailer_url = None
                if trailer["site"].lower() == "youtube":
                    trailer_url = f"https://www.youtube.com/watch?v={trailer['id']}"
                elif trailer["site"].lower() == "dailymotion":
                    trailer_url = f"https://www.dailymotion.com/video/{trailer['id']}"
                if trailer_url:
                    anime.trailer_url = trailer_url
                    anime.save(update_fields=["trailer_url"])

            # Handle characters and voice actors
            try:
                characters_data = item.get("characterPreview", {}).get("edges", [])
                for edge in characters_data:
                    node = edge.get("node", {})
                    role = edge.get("role", "SUPPORTING")

                    char_name = node.get("name", {}).get("full")
                    if not char_name:
                        continue

                    char_native = node.get("name", {}).get("native") or ""
                    char_desc = node.get("description") or ""
                    char_img = node.get("image", {}).get("large")
                    char_anilist_id = node.get("id")

                    if char_anilist_id:
                        character, _ = Character.objects.update_or_create(
                            anilist_id=char_anilist_id,
                            defaults={
                                "name": char_name,
                                "name_native": char_native,
                                "description": char_desc,
                                "image_url": char_img,
                            },
                        )
                    else:
                        character, _ = Character.objects.update_or_create(
                            name=char_name,
                            defaults={
                                "name_native": char_native,
                                "description": char_desc,
                                "image_url": char_img,
                            },
                        )

                    # Handle voice actor (Japanese)
                    voice_actors = edge.get("voiceActors", [])
                    voice_actor = None
                    if voice_actors:
                        va_node = voice_actors[0]
                        va_name = va_node.get("name", {}).get("full")
                        if va_name:
                            va_native = va_node.get("name", {}).get("native") or ""
                            va_img = va_node.get("image", {}).get("large")
                            va_anilist_id = va_node.get("id")
                            if va_anilist_id:
                                voice_actor, _ = Staff.objects.update_or_create(
                                    anilist_id=va_anilist_id,
                                    defaults={
                                        "name": va_name,
                                        "name_native": va_native,
                                        "image_url": va_img,
                                    },
                                )
                            else:
                                voice_actor, _ = Staff.objects.update_or_create(
                                    name=va_name,
                                    defaults={"name_native": va_native, "image_url": va_img},
                                )

                    role_map = {
                        "MAIN": AnimeCharacter.Role.MAIN,
                        "SUPPORTING": AnimeCharacter.Role.SUPPORTING,
                        "BACKGROUND": AnimeCharacter.Role.BACKGROUND,
                    }
                    AnimeCharacter.objects.update_or_create(
                        anime=anime,
                        character=character,
                        voice_actor=voice_actor,
                        defaults={"role": role_map.get(role, AnimeCharacter.Role.SUPPORTING)},
                    )
            except Exception as char_err:
                logger.warning(f"Failed to import characters for {title}: {char_err}")

            # Handle staff
            try:
                staff_data = item.get("staffPreview", {}).get("edges", [])
                for edge in staff_data:
                    node = edge.get("node", {})
                    role = edge.get("role", "")

                    staff_name = node.get("name", {}).get("full")
                    if not staff_name:
                        continue

                    staff_native = node.get("name", {}).get("native") or ""
                    staff_img = node.get("image", {}).get("large")
                    staff_anilist_id = node.get("id")

                    if staff_anilist_id:
                        staff_member, _ = Staff.objects.update_or_create(
                            anilist_id=staff_anilist_id,
                            defaults={
                                "name": staff_name,
                                "name_native": staff_native,
                                "image_url": staff_img,
                            },
                        )
                    else:
                        staff_member, _ = Staff.objects.update_or_create(
                            name=staff_name,
                            defaults={"name_native": staff_native, "image_url": staff_img},
                        )

                    AnimeStaff.objects.update_or_create(
                        anime=anime,
                        staff=staff_member,
                        role=role,
                    )
            except Exception as staff_err:
                logger.warning(f"Failed to import staff for {title}: {staff_err}")

            # Queue theme song sync (requires mal_id)
            if anime.mal_id:
                try:
                    from apps.animes.tasks.themes import sync_theme_songs

                    sync_theme_songs.delay(anime_id=anime.id)
                except Exception as theme_err:
                    logger.warning(f"Failed to queue theme sync for {title}: {theme_err}")

            # Update the source anime's relation slug so future visits are instant
            source_slug = request.data.get("source_slug")
            if source_slug:
                self._update_relation_slug(source_slug, anilist_id, anime.slug)

            return Response(
                {
                    "slug": anime.slug,
                    "title": anime.title,
                    "imported": True,
                }
            )

        except httpx.HTTPStatusError as e:
            logger.error(f"AniList HTTP error for {anilist_id}: {e}", exc_info=True)
            return Response(
                {"error": "External API error"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except httpx.RequestError as e:
            logger.error(f"AniList request error for {anilist_id}: {e}", exc_info=True)
            return Response(
                {"error": "Could not reach external API"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as e:
            logger.error(f"Error importing franchise anime {anilist_id}: {e}", exc_info=True)
            return Response(
                {"error": "Import failed"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @staticmethod
    def _get_client_ip(request):
        """Extract client IP from request for rate limiting."""
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

    @staticmethod
    def _update_relation_slug(source_slug, anilist_id, target_slug):
        """Update the slug in the source anime's relations JSONField."""
        try:
            source_anime = Anime.objects.get(slug=source_slug)
            relations = source_anime.relations or []
            updated = False
            for rel in relations:
                if rel.get("id") == anilist_id and not rel.get("slug"):
                    rel["slug"] = target_slug
                    updated = True
            if updated:
                source_anime.relations = relations
                source_anime.save(update_fields=["relations"])
        except Anime.DoesNotExist:
            pass
        except Exception as e:
            logger.warning(f"Failed to update relation slug for {source_slug}: {e}")

class GenreViewSet(ReadOnlyModelViewSet):
    queryset = Genre.objects.all().order_by("name")
    serializer_class = GenreSerializer
    pagination_class = None

class StudioViewSet(ReadOnlyModelViewSet):
    queryset = Studio.objects.all().order_by("name")
    serializer_class = StudioSerializer
    pagination_class = None
