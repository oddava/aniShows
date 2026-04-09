import hashlib
import json
from dataclasses import dataclass
from datetime import date
from urllib.parse import urlparse

from asgiref.sync import async_to_sync
from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.db.models import (
    Avg,
    Case,
    Count,
    Exists,
    F,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Value,
    When,
)
from django.db.models.functions import Coalesce

from ...shared.logger import logger
from ...shared.public_cache import (
    get_or_build_public_payload,
    invalidate_public_cache_keys,
    public_cache_stale_key,
)
from ...users.models import UserAnimeList, UserProfile
from ..models import Anime, Genre, ThemeSong, UserFavorite
from .jikan import JikanService

VALID_STATUSES = {"airing", "finished", "upcoming", "not_yet_aired"}
VALID_TYPES = {"tv", "movie", "ova", "ona", "special", "music"}
VALID_SEASONS = {"winter", "spring", "summer", "fall"}
MAX_RATING = 10.0
MIN_RATING = 0.0
ADULT_GENRE_SLUGS = {"erotica", "hentai"}
ADULT_TAGS = {
    "ahegao",
    "anal sex",
    "ashikoki",
    "boobjob",
    "cervix penetration",
    "cumflation",
    "cunnilingus",
    "deepthroat",
    "defloration",
    "double penetration",
    "explicit sex",
    "facial",
    "fellatio",
    "femdom",
    "futanari",
    "group sex",
    "handjob",
    "incest",
    "inseki",
    "irrumatio",
    "lactation",
    "masturbation",
    "mating press",
    "nakadashi",
    "netorare",
    "netorase",
    "netori",
    "nsfw",
    "oyakodon",
    "prostitution",
    "public sex",
    "rape",
    "rimjob",
    "sex",
    "sex toys",
    "succubus",
    "squirting",
    "sumata",
    "threesome",
}


def build_user_list_status_payload(entry, episode_count: int | None) -> dict:
    resolved_episode_count = int(episode_count or 0)
    return {
        "id": entry.id,
        "status": entry.status,
        "score": entry.score,
        "episodes_watched": entry.episodes_watched,
        "notes": entry.notes,
        "started_at": str(entry.started_at) if entry.started_at else None,
        "finished_at": str(entry.finished_at) if entry.finished_at else None,
        "total_rewatches": entry.total_rewatches,
        "is_rewatching": entry.is_rewatching,
        "progress": (
            entry.episodes_watched / resolved_episode_count * 100
            if resolved_episode_count > 0
            else 0
        ),
    }


@dataclass(slots=True)
class CachedPayloadResult:
    data: dict | list
    cache_status: str


class AnimeQueryService:
    DETAIL_DEFER_FIELDS = (
        "offline_db_payload",
        "provider_ids",
        "source_urls",
        "synonyms",
        "producers",
        "meta_description",
    )
    ACTION_ANIME_ONLY_FIELDS = (
        "id",
        "slug",
        "title",
        "episode_count",
        "updated_at",
        "mal_id",
        "anilist_id",
    )
    LIST_FIELDS = (
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
    )
    GENRE_FIELDS = ("id", "name", "slug")
    THEME_SONG_FIELDS = (
        "id",
        "anime_id",
        "song_type",
        "track_number",
        "title",
        "artist",
        "episodes",
        "spotify_url",
        "youtube_url",
    )
    USER_LIST_FIELDS = (
        "id",
        "anime_id",
        "status",
        "score",
        "episodes_watched",
        "notes",
        "started_at",
        "finished_at",
        "total_rewatches",
        "is_rewatching",
    )
    SORT_MAPPING = {
        "popular": "popularity_rank",
        "rating": "-rating",
        "newest": "-release_date",
        "title": "title",
        "upcoming": "-member_count",
        "trending": "trending_rank",
    }

    @classmethod
    def _genre_prefetch(cls) -> Prefetch:
        return Prefetch(
            "genres",
            queryset=Genre.objects.only(*cls.GENRE_FIELDS).order_by("name"),
        )

    @classmethod
    def _theme_song_prefetch(cls) -> Prefetch:
        return Prefetch(
            "theme_songs",
            # Detail payloads only expose a small slice of theme-song fields.
            queryset=ThemeSong.objects.only(*cls.THEME_SONG_FIELDS).order_by(
                "song_type", "track_number"
            ),
        )

    @classmethod
    def _user_list_prefetch(cls, user) -> Prefetch:
        return Prefetch(
            "user_lists",
            # Keeping this narrow prevents browse pages from pulling the whole list table into memory.
            queryset=UserAnimeList.objects.filter(user=user).only(*cls.USER_LIST_FIELDS),
            to_attr="_user_list_entries",
        )

    def build_queryset(self, request, *, action: str, include_user_context: bool = True):
        is_list = action == "list"
        queryset = Anime.public_queryset().select_related("studio")

        if is_list:
            queryset = queryset.only(*self.LIST_FIELDS, "studio__id", "studio__name")
            queryset = queryset.prefetch_related(self._genre_prefetch())
        else:
            queryset = (
                queryset.prefetch_related(self._genre_prefetch(), self._theme_song_prefetch())
                .defer(*self.DETAIL_DEFER_FIELDS)
                .annotate(
                    character_count=Count("cast", distinct=True),
                    staff_count=Count("production_staff", distinct=True),
                )
            )

        user = request.user
        if include_user_context and user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(UserFavorite.objects.filter(user=user, anime=OuterRef("pk")))
            ).prefetch_related(self._user_list_prefetch(user))

        if not is_list:
            return queryset.annotate(
                review_count=Count("reviews", distinct=True),
                avg_rating=Avg("reviews__rating"),
            ).order_by("-id")

        return self._apply_list_filters(queryset, request)

    def get_action_anime(self, slug: str) -> Anime:
        return Anime.public_queryset().only(*self.ACTION_ANIME_ONLY_FIELDS).get(slug=slug)

    def related_queryset(self, anime):
        relation_slugs = self._relation_slugs(anime)[:8]
        base_queryset = self.base_shelf_queryset()

        if relation_slugs:
            ordering = Case(
                *[When(slug=slug, then=Value(index)) for index, slug in enumerate(relation_slugs)],
                default=Value(len(relation_slugs)),
                output_field=IntegerField(),
            )
            return (
                base_queryset.filter(slug__in=relation_slugs)
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

    def recommendations_queryset(self, anime):
        relation_anilist_ids = set(self._relation_anilist_ids(anime))
        if anime.anilist_id:
            service = JikanService(enable_caching=True, enable_rate_limiting=True)
            try:
                recommendations = async_to_sync(service.get_recommendations_for_anime)(
                    anime.anilist_id,
                    limit=12,
                    request_budget=service.REQUEST_BUDGET_INTERACTIVE,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to fetch Jikan recommendations for %s (%s): %s",
                    anime.slug,
                    anime.anilist_id,
                    exc,
                )
                recommendations = []
            finally:
                async_to_sync(service.close)()

            ordered_anilist_ids = []
            for recommendation in recommendations:
                recommendation_id = recommendation.get("id")
                if (
                    not recommendation_id
                    or recommendation_id == anime.anilist_id
                    or recommendation_id in relation_anilist_ids
                ):
                    continue
                ordered_anilist_ids.append(recommendation_id)

            ordered_anilist_ids = list(dict.fromkeys(ordered_anilist_ids))
            if ordered_anilist_ids:
                ordering = Case(
                    *[
                        When(anilist_id=anilist_id, then=Value(index))
                        for index, anilist_id in enumerate(ordered_anilist_ids)
                    ],
                    default=Value(len(ordered_anilist_ids)),
                    output_field=IntegerField(),
                )
                queryset = (
                    self.base_shelf_queryset()
                    .filter(anilist_id__in=ordered_anilist_ids)
                    .exclude(id=anime.id)
                    .annotate(recommendation_order=ordering)
                    .order_by("recommendation_order", "-id")
                )
                if queryset.exists():
                    return queryset

        return self._fallback_recommendations_queryset(anime)

    @staticmethod
    def base_shelf_queryset():
        return (
            Anime.public_queryset()
            .select_related("studio")
            .only(*AnimeQueryService.LIST_FIELDS, "studio__id", "studio__name")
            .prefetch_related(AnimeQueryService._genre_prefetch())
        )

    def _apply_list_filters(self, queryset, request):
        needs_distinct = False
        query_params = request.query_params

        if not self._can_view_adult_content(request.user):
            queryset = self._exclude_adult_content(queryset)

        search = query_params.get("q")
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

        genres = self._parse_multi_value_params(query_params.getlist("genre"))
        if genres:
            for genre in genres:
                queryset = queryset.filter(genres__slug=genre)
            needs_distinct = True

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
                queryset = queryset.filter(studio__id=studio_id)

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

        has_temporal_filters = any(
            [
                bool(query_params.get("season")),
                bool(query_params.get("year")),
                bool(query_params.get("min_year")),
                bool(query_params.get("max_year")),
            ]
        )

        has_active_filters = any(
            [
                bool(search),
                bool(genres),
                bool(anime_status),
                bool(anime_type),
                bool(studio),
                bool(query_params.get("min_rating")),
                bool(query_params.get("max_rating")),
                bool(source_material),
                bool(tags),
                bool(query_params.get("min_episodes")),
                bool(query_params.get("max_episodes")),
                bool(query_params.get("min_duration")),
                bool(query_params.get("max_duration")),
                has_temporal_filters,
            ]
        )

        sort_clean = (query_params.get("sort", "popular") or "popular").strip().lower()
        sort_field = self.SORT_MAPPING.get(sort_clean, "popularity_rank")
        ordering = [sort_field, "-id"]

        if sort_clean == "rating":
            queryset = queryset.filter(rating__isnull=False, member_count__gt=200000)
        elif sort_clean == "newest":
            queryset = queryset.filter(episode_count__gt=0)
        elif sort_clean == "upcoming":
            queryset = queryset.filter(status="Upcoming")
        elif sort_clean == "popular":
            if not has_active_filters:
                queryset = queryset.filter(popularity_rank__isnull=False)
            elif has_temporal_filters:
                queryset = queryset.annotate(
                    popularity_missing=Case(
                        # Future-season rows often arrive before a canonical popularity rank exists.
                        When(popularity_rank__isnull=True, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    ),
                    site_missing=Case(
                        # Keep site_rank as a secondary signal before falling back to raw member counts.
                        When(site_rank__isnull=True, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    ),
                    rating_missing=Case(
                        When(rating__isnull=True, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    ),
                    member_sort=Coalesce(F("member_count"), Value(0)),
                )
                ordering = [
                    "popularity_missing",
                    "popularity_rank",
                    "site_missing",
                    "site_rank",
                    "rating_missing",
                    "-rating",
                    "-member_sort",
                    "-id",
                ]
            else:
                queryset = queryset.annotate(member_sort=Coalesce(F("member_count"), 0))
                ordering = ["-member_sort", "-id"]
        elif sort_clean == "trending":
            queryset = queryset.filter(trending_rank__isnull=False)

        queryset = queryset.order_by(*ordering)
        if needs_distinct:
            queryset = queryset.distinct()
        return queryset

    @staticmethod
    def _can_view_adult_content(user) -> bool:
        if not getattr(user, "is_authenticated", False):
            return False
        return bool(
            UserProfile.objects.filter(user_id=user.id, show_adult_content=True).values_list(
                "show_adult_content", flat=True
            ).first()
        )

    @classmethod
    def _exclude_adult_content(cls, queryset):
        adult_ids = Anime.objects.using(queryset.db).filter(
            Q(genres__slug__in=ADULT_GENRE_SLUGS) | cls._adult_tags_q(queryset.db)
        )
        return queryset.exclude(pk__in=adult_ids.values("pk"))

    @staticmethod
    def _adult_tags_q(database_alias: str) -> Q:
        vendor = connections[database_alias].vendor
        condition = Q()
        for tag in ADULT_TAGS:
            if vendor == "postgresql":
                condition |= Q(tags__contains=[tag])
            else:
                condition |= Q(tags__icontains=json.dumps(tag))
        return condition

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
    def _filter_case_insensitive_values(queryset, raw_value, field_name: str, valid_values: set[str]):
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
    def _apply_numeric_range_filter(
        queryset,
        field_name: str,
        min_value,
        max_value,
        *,
        min_allowed,
        max_allowed,
        value_type,
    ):
        if min_value not in (None, ""):
            try:
                min_resolved = value_type(min_value)
            except (TypeError, ValueError):
                min_resolved = None
            if min_resolved is not None and min_allowed <= min_resolved <= max_allowed:
                queryset = queryset.filter(**{f"{field_name}__gte": min_resolved})

        if max_value not in (None, ""):
            try:
                max_resolved = value_type(max_value)
            except (TypeError, ValueError):
                max_resolved = None
            if max_resolved is not None and min_allowed <= max_resolved <= max_allowed:
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
    def _apply_year_filters(queryset, query_params):
        season = query_params.get("season")
        year = query_params.get("year")
        if year:
            try:
                year_int = int(year)
            except (TypeError, ValueError):
                year_int = None
            if year_int and 1980 <= year_int <= 2050:
                season_ranges = {
                    "winter": [(year_int, 1, 1), (year_int, 3, 31)],
                    "spring": [(year_int, 4, 1), (year_int, 6, 30)],
                    "summer": [(year_int, 7, 1), (year_int, 9, 30)],
                    "fall": [(year_int, 10, 1), (year_int, 12, 31)],
                }
                season_clean = season.strip().lower() if season else None
                if season_clean and season_clean in VALID_SEASONS:
                    start, end = season_ranges[season_clean]
                    explicit_season_match = Q(season__iexact=season_clean, season_year=year_int)
                    release_date_fallback = (
                        Q(season="", season_year__isnull=True)
                        | Q(season="", season_year=year_int)
                        | Q(season_year__isnull=True)
                    ) & Q(
                        release_date__gte=date(*start),
                        release_date__lte=date(*end),
                    )
                    return queryset.filter(
                        explicit_season_match | release_date_fallback
                    )
                start, end = AnimeQueryService._year_bounds(year_int)
                return queryset.filter(
                    Q(season_year=year_int)
                    | Q(season_year__isnull=True, release_date__gte=start, release_date__lte=end)
                )
            return queryset

        min_year = query_params.get("min_year")
        if min_year:
            try:
                min_year_int = int(min_year)
            except (TypeError, ValueError):
                min_year_int = None
            if min_year_int and 1980 <= min_year_int <= 2050:
                min_start, _ = AnimeQueryService._year_bounds(min_year_int)
                queryset = queryset.filter(
                    # Upcoming rows often only have season metadata, so keep them in year-range views.
                    Q(season_year__gte=min_year_int)
                    | Q(season_year__isnull=True, release_date__gte=min_start)
                )

        max_year = query_params.get("max_year")
        if max_year:
            try:
                max_year_int = int(max_year)
            except (TypeError, ValueError):
                max_year_int = None
            if max_year_int and 1980 <= max_year_int <= 2050:
                _, max_end = AnimeQueryService._year_bounds(max_year_int)
                queryset = queryset.filter(
                    # Treat season_year as the canonical year when release_date is still unknown.
                    Q(season_year__lte=max_year_int)
                    | Q(season_year__isnull=True, release_date__lte=max_end)
                )

        return queryset

    @staticmethod
    def _relation_anilist_ids(anime) -> list[int]:
        relation_ids = []
        for relation in anime.relations or []:
            if not isinstance(relation, dict):
                continue
            relation_id = relation.get("id")
            if relation_id and relation_id != anime.anilist_id:
                relation_ids.append(relation_id)
        return list(dict.fromkeys(relation_ids))

    @staticmethod
    def _relation_slugs(anime) -> list[str]:
        relation_slugs = []
        for relation in anime.relations or []:
            if not isinstance(relation, dict):
                continue
            relation_slug = relation.get("slug")
            if relation_slug and relation_slug != anime.slug:
                relation_slugs.append(relation_slug)
        return list(dict.fromkeys(relation_slugs))

    @staticmethod
    def _genre_ids(anime) -> list[int]:
        prefetched_genres = getattr(anime, "_prefetched_objects_cache", {}).get("genres")
        if prefetched_genres is not None:
            # Related/recommendation actions already prefetch genres on the source anime.
            return [genre.id for genre in prefetched_genres]
        return list(anime.genres.values_list("id", flat=True))

    def _fallback_recommendations_queryset(self, anime):
        relation_anilist_ids = self._relation_anilist_ids(anime)
        relation_slugs = self._relation_slugs(anime)
        genre_ids = self._genre_ids(anime)

        queryset = self.base_shelf_queryset().exclude(id=anime.id)
        if relation_anilist_ids:
            queryset = queryset.exclude(anilist_id__in=relation_anilist_ids)
        if relation_slugs:
            queryset = queryset.exclude(slug__in=relation_slugs)

        return (
            queryset.filter(genres__in=genre_ids)
            .annotate(shared_genres=Count("genres"))
            .order_by("-shared_genres", "-rating", "-id")[:8]
        )


class AnimePublicPayloadService:
    PUBLIC_CACHE_VERSION = "v9"
    INTERNAL_MEDIA_HOSTS = {"localhost", "127.0.0.1", "minio", "web"}
    MEDIA_URL_FIELDS = (
        "cover_image",
        "cover_image_small",
        "cover_image_medium",
        "cover_image_large",
        "banner_image",
        "banner_image_small",
        "banner_image_medium",
        "banner_image_large",
    )

    @classmethod
    def detail_cache_key(cls, slug: str) -> str:
        return f"anime_detail_base:{cls.PUBLIC_CACHE_VERSION}:{slug}"

    @classmethod
    def detail_cache_keys(cls, slug: str) -> tuple[str, ...]:
        return (
            cls.detail_cache_key(slug),
            # Read through older keys so stale detail caches can self-heal after deploys.
            f"anime_detail_base:{slug}",
            f"anime_detail_base:v6:{slug}",
            f"anime_detail_base:v5:{slug}",
            f"anime_detail_base:v4:{slug}",
            f"anime_detail_base:v3:{slug}",
            f"anime_detail_base:v2:{slug}",
        )

    @staticmethod
    def sanitize_public_user_fields(payload):
        if not isinstance(payload, dict):
            return payload

        sanitized = payload.copy()
        sanitized["is_favorite"] = False
        sanitized["user_list_status"] = None
        return sanitized

    @staticmethod
    def has_cover_media(data: dict) -> bool:
        return bool(
            data.get("cover_image_large")
            or data.get("cover_image_medium")
            or data.get("cover_image_small")
            or data.get("cover_image")
        )

    @classmethod
    def cache_list_payload(cls, request, build_payload):
        if request.user.is_authenticated:
            return CachedPayloadResult(data=build_payload(), cache_status="skip")

        params = dict(request.query_params)
        param_string = json.dumps(sorted(params.items()), separators=(",", ":"))
        cache_key_hash = hashlib.sha256(param_string.encode()).hexdigest()
        cache_key = f"anime_list:{cls.PUBLIC_CACHE_VERSION}:{cache_key_hash}"
        data, cache_status = get_or_build_public_payload(
            cache_key,
            build_payload,
            ttl=300,
            validator=cls.is_valid_public_payload,
        )
        return CachedPayloadResult(data=data, cache_status=cache_status)

    @classmethod
    def cache_shelf_payload(cls, cache_key: str, build_payload):
        data, cache_status = get_or_build_public_payload(
            cache_key,
            build_payload,
            ttl=600,
            validator=cls.is_valid_public_payload,
        )
        return CachedPayloadResult(data=data, cache_status=cache_status)

    @classmethod
    def get_detail_payload(cls, slug: str, request, query_service: AnimeQueryService):
        cache_keys = cls.detail_cache_keys(slug)
        primary_cache_key = cache_keys[0]
        cached_base = None
        cache_hit_key = None
        cache_status = "hit"
        for key in cache_keys:
            cached_base = cache.get(key)
            if cached_base is not None:
                cache_hit_key = key
                break

        needs_refresh = cached_base is None
        if cached_base:
            data = cls.sanitize_public_user_fields(cached_base)
            cache_payload_changed = data != cached_base
            if not cls.has_cover_media(data) or cls.item_has_internal_media_urls(
                data
            ) or cls.item_has_stale_imagekit_cache_urls(data):
                needs_refresh = True
                invalidate_public_cache_keys(*cache_keys)
            elif cache_hit_key != primary_cache_key or cache_payload_changed:
                ttl = 3600 if cls.has_cover_media(data) else 60
                cache.set(primary_cache_key, data, ttl)
                cache.set(public_cache_stale_key(primary_cache_key), data, ttl + 900)
        else:
            data = None

        if needs_refresh:
            def build_base_payload():
                from ..serializers.anime import AnimeDetailSerializer

                instance = query_service.build_queryset(
                    request,
                    action="retrieve",
                    include_user_context=False,
                ).get(slug=slug)
                serializer = AnimeDetailSerializer(instance, context={"request": request})
                return cls.sanitize_public_user_fields(serializer.data)

            data, cache_status = get_or_build_public_payload(
                primary_cache_key,
                build_base_payload,
                ttl=3600,
                validator=lambda payload: (
                    not cls.item_has_internal_media_urls(payload)
                    and not cls.item_has_stale_imagekit_cache_urls(payload)
                ),
            )
            if cache_hit_key and cache_hit_key != primary_cache_key:
                ttl = 3600 if cls.has_cover_media(data) else 60
                # Rehydrate the legacy key that was actually requested so older readers converge.
                cache.set(cache_hit_key, data, ttl)
                cache.set(public_cache_stale_key(cache_hit_key), data, ttl + 900)

        if request.user.is_authenticated:
            data = cls.enrich_detail_payload_for_user(data, request.user)

        return CachedPayloadResult(data=data, cache_status=cache_status)

    @classmethod
    def enrich_detail_payload_for_user(cls, data: dict, user):
        if not data or not getattr(user, "is_authenticated", False):
            return data

        enriched = dict(data)
        anime_id = enriched["id"]
        enriched["is_favorite"] = UserFavorite.objects.filter(user=user, anime_id=anime_id).exists()
        entry = UserAnimeList.objects.filter(user=user, anime_id=anime_id).first()
        enriched["user_list_status"] = (
            build_user_list_status_payload(entry, enriched.get("episode_count"))
            if entry
            else None
        )
        return enriched

    @classmethod
    def enrich_collection_payload_for_user(cls, data: list[dict], user):
        if not data or not getattr(user, "is_authenticated", False):
            return data

        anime_ids = [item["id"] for item in data]
        favorite_ids = set(
            UserFavorite.objects.filter(user=user, anime_id__in=anime_ids).values_list(
                "anime_id", flat=True
            )
        )
        list_entries = {
            entry.anime_id: entry
            for entry in UserAnimeList.objects.filter(user=user, anime_id__in=anime_ids)
        }
        return [
            {
                **item,
                "is_favorite": item["id"] in favorite_ids,
                "user_list_status": (
                    build_user_list_status_payload(
                        list_entries[item["id"]],
                        item.get("episode_count"),
                    )
                    if item["id"] in list_entries
                    else None
                ),
            }
            for item in data
        ]

    @classmethod
    def item_has_internal_media_urls(cls, item: dict) -> bool:
        if not isinstance(item, dict):
            return False

        for field in cls.MEDIA_URL_FIELDS:
            value = item.get(field)
            if not isinstance(value, str) or not value.startswith(("http://", "https://")):
                continue
            host = (urlparse(value).hostname or "").lower()
            if host in cls.INTERNAL_MEDIA_HOSTS:
                return True
        return False

    @classmethod
    def payload_has_internal_media_urls(cls, payload) -> bool:
        if isinstance(payload, list):
            return any(cls.item_has_internal_media_urls(item) for item in payload)
        if isinstance(payload, dict):
            results = payload.get("results")
            if isinstance(results, list):
                return any(cls.item_has_internal_media_urls(item) for item in results)
            return cls.item_has_internal_media_urls(payload)
        return False

    @classmethod
    def current_imagekit_cache_path_prefix(cls) -> str:
        return f"/media/{settings.IMAGEKIT_CACHEFILE_DIR.strip('/')}/"

    @classmethod
    def legacy_imagekit_cache_path_prefixes(cls) -> tuple[str, ...]:
        return tuple(
            f"/media/{prefix.strip('/')}/"
            for prefix in getattr(settings, "IMAGEKIT_LEGACY_CACHEFILE_DIRS", ())
            if prefix.strip("/")
        )

    @classmethod
    def item_has_stale_imagekit_cache_urls(cls, item: dict) -> bool:
        if not isinstance(item, dict):
            return False

        current_prefix = cls.current_imagekit_cache_path_prefix()
        legacy_prefixes = cls.legacy_imagekit_cache_path_prefixes()

        for field in cls.MEDIA_URL_FIELDS:
            value = item.get(field)
            if not isinstance(value, str):
                continue

            path = urlparse(value).path if value.startswith(("http://", "https://")) else value
            if "/media/CACHE/" not in path:
                continue
            if path.startswith(current_prefix):
                continue
            if legacy_prefixes and any(path.startswith(prefix) for prefix in legacy_prefixes):
                return True
            return True

        return False

    @classmethod
    def payload_has_stale_imagekit_cache_urls(cls, payload) -> bool:
        if isinstance(payload, list):
            return any(cls.item_has_stale_imagekit_cache_urls(item) for item in payload)
        if isinstance(payload, dict):
            results = payload.get("results")
            if isinstance(results, list):
                return any(cls.item_has_stale_imagekit_cache_urls(item) for item in results)
            return cls.item_has_stale_imagekit_cache_urls(payload)
        return False

    @classmethod
    def is_valid_public_payload(cls, payload) -> bool:
        return not (
            cls.payload_has_internal_media_urls(payload)
            or cls.payload_has_stale_imagekit_cache_urls(payload)
        )
