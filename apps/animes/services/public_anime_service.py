import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Case, Count, Exists, IntegerField, OuterRef, Q, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from ...shared.logger import logger
from ...shared.public_cache import (
    get_or_build_public_payload,
    invalidate_public_cache_keys,
    public_cache_stale_key,
)
from ...users.models import UserAnimeList
from ..adult_content import ADULT_GENRE_SLUGS, ADULT_TAGS
from ..models import Anime, AnimeCharacter, AnimeStaff, UserFavorite
from .jikan import JikanService
from .public_query.fields import QueryFieldsMixin
from .public_query.filters import (
    MAX_RATING,
    MIN_RATING,
    MIN_SEARCH_LENGTH,
    MIN_SYNOPSIS_SEARCH_LENGTH,
    VALID_SEASONS,
    VALID_STATUSES,
    VALID_TYPES,
    ListFilterMixin,
)
from .public_query.shelves import ShelfMixin
from .public_query.sorting import SortingMixin

__all__ = [
    "ADULT_GENRE_SLUGS",
    "ADULT_TAGS",
    "MAX_RATING",
    "MIN_RATING",
    "MIN_SEARCH_LENGTH",
    "MIN_SYNOPSIS_SEARCH_LENGTH",
    "VALID_SEASONS",
    "VALID_STATUSES",
    "VALID_TYPES",
    "AnimePublicPayloadService",
    "AnimeQueryService",
    "CachedPayloadResult",
    "build_user_list_status_payload",
]


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


class AnimeQueryService(QueryFieldsMixin, ListFilterMixin, SortingMixin, ShelfMixin):
    """Querysets for the public anime endpoints.

    Filters, sorting, shelves and field lists live in ``services/public_query/``;
    this class combines them and keeps the detail, schedule and recommendation
    querysets.
    """

    SCHEDULE_DAY_NAMES = (
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    )
    SCHEDULE_DAY_LOOKUP = {day.lower(): day for day in SCHEDULE_DAY_NAMES}

    def build_queryset(self, request, *, action: str, include_user_context: bool = True):
        is_list = action == "list"
        queryset = Anime.public_queryset().prefetch_related(Anime.studios_prefetch())

        if is_list:
            queryset = queryset.only(*self.LIST_FIELDS)
            queryset = queryset.prefetch_related(self._genre_prefetch())
        else:
            queryset = (
                queryset.prefetch_related(
                    self._genre_prefetch(), self._theme_song_prefetch(), Anime.relations_prefetch()
                )
                .defer(*self.DETAIL_DEFER_FIELDS)
                .annotate(
                    character_count=Coalesce(
                        self._count_subquery(AnimeCharacter),
                        Value(0),
                    ),
                    staff_count=Coalesce(
                        self._count_subquery(AnimeStaff),
                        Value(0),
                    ),
                )
            )

        user = request.user
        # Keep browse queries lean: list pages add user-specific status after pagination.
        if include_user_context and user.is_authenticated and not is_list:
            queryset = queryset.annotate(
                _is_favorite=Exists(UserFavorite.objects.filter(user=user, anime=OuterRef("pk")))
            ).prefetch_related(self._user_list_prefetch(user))

        if not is_list:
            return queryset.annotate(
                review_count=Count("reviews", distinct=True),
                avg_rating=Avg("reviews__rating"),
            ).order_by("-id")

        return self._apply_list_filters(queryset, request)

    def schedule_queryset(self, user, *, include_user_context: bool = True):
        queryset = (
            Anime.public_queryset()
            .filter(status=Anime.AnimeStatus.airing)
            .filter(
                Q(broadcast_day__in=self.SCHEDULE_DAY_NAMES) | Q(next_airing_date__isnull=False)
            )
            .only(*self.LIST_FIELDS)
            .prefetch_related(self._genre_prefetch(), Anime.studios_prefetch())
            .order_by("broadcast_day", "broadcast_time", "next_airing_date", "title", "id")
        )

        if not self.can_view_adult_content(user):
            queryset = self._exclude_adult_content(queryset)

        if include_user_context and user.is_authenticated:
            queryset = queryset.annotate(
                _is_favorite=Exists(UserFavorite.objects.filter(user=user, anime=OuterRef("pk")))
            ).prefetch_related(self._user_list_prefetch(user))

        return queryset

    @classmethod
    def normalize_schedule_day(cls, day: str | None) -> str | None:
        return cls.SCHEDULE_DAY_LOOKUP.get(str(day or "").strip().lower())

    @classmethod
    def resolve_schedule_day(cls, anime) -> str | None:
        broadcast_day = cls.normalize_schedule_day(getattr(anime, "broadcast_day", None))
        if broadcast_day:
            return broadcast_day

        next_airing_date = getattr(anime, "next_airing_date", None)
        if next_airing_date is None:
            return None

        timezone_name = getattr(anime, "broadcast_timezone", "") or "Asia/Tokyo"
        try:
            local_tz = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError):
            local_tz = ZoneInfo("Asia/Tokyo")
        # Jikan next-airing timestamps are tied to the broadcast timezone; UTC shifts late-night JST shows backward.
        localized = timezone.localtime(next_airing_date, local_tz)
        return cls.SCHEDULE_DAY_NAMES[(localized.weekday() + 1) % 7]

    def get_action_anime(self, slug: str) -> Anime:
        return Anime.public_queryset().only(*self.ACTION_ANIME_ONLY_FIELDS).get(slug=slug)

    def recommendations_queryset(self, anime, *, can_view_adult_content: bool = True):
        relation_mal_ids = set(self._relation_mal_ids(anime))
        if anime.mal_id:
            service = JikanService(enable_caching=True, enable_rate_limiting=True)
            try:
                recommendations = service.get_recommendations_for_anime(
                    anime.mal_id,
                    limit=12,
                    request_budget=service.REQUEST_BUDGET_INTERACTIVE,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to fetch Jikan recommendations for %s (MAL %s): %s",
                    anime.slug,
                    anime.mal_id,
                    exc,
                    exc_info=True,
                )
                recommendations = []
            finally:
                service.close()

            ordered_mal_ids = []
            for recommendation in recommendations:
                recommendation_mal_id = recommendation.get("mal_id")
                if (
                    not recommendation_mal_id
                    or recommendation_mal_id == anime.mal_id
                    or recommendation_mal_id in relation_mal_ids
                ):
                    continue
                ordered_mal_ids.append(recommendation_mal_id)

            ordered_mal_ids = list(dict.fromkeys(ordered_mal_ids))
            if ordered_mal_ids:
                ordering = Case(
                    *[
                        When(mal_id=mal_id, then=Value(index))
                        for index, mal_id in enumerate(ordered_mal_ids)
                    ],
                    default=Value(len(ordered_mal_ids)),
                    output_field=IntegerField(),
                )
                queryset = (
                    self.shelf_queryset_for(can_view_adult_content)
                    .filter(mal_id__in=ordered_mal_ids)
                    .exclude(id=anime.id)
                    .annotate(recommendation_order=ordering)
                    .order_by("recommendation_order", "-id")
                )
                if queryset.exists():
                    return queryset

        return self._fallback_recommendations_queryset(
            anime, can_view_adult_content=can_view_adult_content
        )

    @classmethod
    def _current_and_next_seasons(cls) -> tuple[str, int, str, int]:
        return cls.season_window_for_date(date.today())


class AnimePublicPayloadService:
    PUBLIC_CACHE_VERSION = "v11"
    COLLECTION_CACHE_NAMESPACE_KEY = f"anime_collection_ns:{PUBLIC_CACHE_VERSION}"
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
    def schedule_cache_key(cls, day_key: str, can_view_adult_content: bool) -> str:
        """``day_key`` is a lowercase day name, or ``"all"`` for the whole week."""
        return (
            f"anime_schedule:{cls.PUBLIC_CACHE_VERSION}:day:{day_key}"
            f":adult:{int(can_view_adult_content)}"
        )

    @classmethod
    def schedule_cache_keys(cls) -> tuple[str, ...]:
        day_keys = ("all", *(day.lower() for day in AnimeQueryService.SCHEDULE_DAY_NAMES))
        return tuple(
            cls.schedule_cache_key(day_key, flag) for day_key in day_keys for flag in (False, True)
        )

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
        cache_key = cls._with_collection_namespace(
            f"anime_list:{cls.PUBLIC_CACHE_VERSION}:{cache_key_hash}"
        )
        data, cache_status = get_or_build_public_payload(
            cache_key,
            build_payload,
            ttl=300,
            validator=cls.is_valid_public_payload,
        )
        return CachedPayloadResult(data=data, cache_status=cache_status)

    @classmethod
    def cache_shelf_payload(cls, cache_key: str, build_payload):
        cache_key = cls._with_collection_namespace(cache_key)
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
        coverless_marker_key = f"{primary_cache_key}:coverless_checked"
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
            # Rebuild a coverless payload to pick up a cover saved since, but at
            # most once a minute: a show with no cover would otherwise rebuild
            # the full detail query on every request.
            coverless_needs_check = not cls.has_cover_media(data) and not cache.get(
                coverless_marker_key
            )
            if (
                coverless_needs_check
                or cls.item_has_internal_media_urls(data)
                or cls.item_has_stale_imagekit_cache_urls(data)
            ):
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
            if cache_status == "miss" and not cls.has_cover_media(data):
                cache.set(coverless_marker_key, True, 60)
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
            build_user_list_status_payload(entry, enriched.get("episode_count")) if entry else None
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
    def enrich_browse_rows_payload_for_user(cls, data: list[dict], user):
        if not data or not getattr(user, "is_authenticated", False):
            return data

        anime_ids = [
            anime["id"]
            for row in data
            for anime in row.get("anime_list", [])
            if isinstance(anime, dict) and anime.get("id")
        ]
        if not anime_ids:
            return data

        favorite_ids = set(
            UserFavorite.objects.filter(user=user, anime_id__in=anime_ids).values_list(
                "anime_id", flat=True
            )
        )
        list_entries = {
            entry.anime_id: entry
            for entry in UserAnimeList.objects.filter(user=user, anime_id__in=anime_ids)
        }

        enriched_rows = []
        for row in data:
            enriched_rows.append(
                {
                    **row,
                    "anime_list": [
                        {
                            **anime,
                            "is_favorite": anime["id"] in favorite_ids,
                            "user_list_status": (
                                build_user_list_status_payload(
                                    list_entries[anime["id"]],
                                    anime.get("episode_count"),
                                )
                                if anime["id"] in list_entries
                                else None
                            ),
                        }
                        for anime in row.get("anime_list", [])
                    ],
                }
            )

        return enriched_rows

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
    def collection_cache_namespace(cls) -> str:
        namespace = cache.get(cls.COLLECTION_CACHE_NAMESPACE_KEY)
        if namespace is None:
            namespace = "0"
            cache.set(cls.COLLECTION_CACHE_NAMESPACE_KEY, namespace, None)
        return namespace

    @classmethod
    def bump_collection_cache_namespace(cls) -> str:
        namespace = uuid.uuid4().hex
        cache.set(cls.COLLECTION_CACHE_NAMESPACE_KEY, namespace, None)
        return namespace

    @classmethod
    def _with_collection_namespace(cls, cache_key: str) -> str:
        return f"{cache_key}:ns:{cls.collection_cache_namespace()}"

    @classmethod
    def payload_has_internal_media_urls(cls, payload) -> bool:
        if isinstance(payload, list):
            return any(cls.payload_has_internal_media_urls(item) for item in payload)
        if isinstance(payload, dict):
            results = payload.get("results")
            if isinstance(results, list):
                return any(cls.item_has_internal_media_urls(item) for item in results)
            anime_list = payload.get("anime_list")
            if isinstance(anime_list, list):
                return any(cls.item_has_internal_media_urls(item) for item in anime_list)
            return cls.item_has_internal_media_urls(payload)
        return False

    @classmethod
    def current_imagekit_cache_path_prefix(cls) -> str:
        return f"/media/{settings.IMAGEKIT_CACHEFILE_DIR.strip('/')}/"

    @classmethod
    def legacy_imagekit_cache_path_prefixes(cls) -> tuple[str, ...]:
        return tuple(
            f"/media/{prefix.strip('/')}/"
            for prefix in settings.IMAGEKIT_LEGACY_CACHEFILE_DIRS
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
            return any(cls.payload_has_stale_imagekit_cache_urls(item) for item in payload)
        if isinstance(payload, dict):
            results = payload.get("results")
            if isinstance(results, list):
                return any(cls.item_has_stale_imagekit_cache_urls(item) for item in results)
            anime_list = payload.get("anime_list")
            if isinstance(anime_list, list):
                return any(cls.item_has_stale_imagekit_cache_urls(item) for item in anime_list)
            return cls.item_has_stale_imagekit_cache_urls(payload)
        return False

    @classmethod
    def is_valid_public_payload(cls, payload) -> bool:
        return not (
            cls.payload_has_internal_media_urls(payload)
            or cls.payload_has_stale_imagekit_cache_urls(payload)
        )
