import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Case, Count, Exists, IntegerField, OuterRef, Q, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from ...shared.errors import CACHE_ERRORS
from ...shared.logger import logger
from ...shared.pagination import NoCountPagination
from ...shared.parsing import positive_int
from ...shared.public_cache import (
    CACHE_OUTAGE_VERSION,
    get_or_build_public_payload,
    invalidate_public_cache_keys,
    public_cache_stale_key,
)
from ...shared.throttling import warn_cache_outage
from ...users.models import UserAnimeList
from ..models import Anime, AnimeCharacter, AnimeStaff, UserFavorite
from .anilist import TRANSIENT_ERROR_CODES, AniListService
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
    # The schedule ships what airs from a day ago to 8 days ahead (B7): a stale
    # ``next_airing_date`` or a show on hiatus would land on the wrong date.
    SCHEDULE_WINDOW_BEFORE = timedelta(days=1)
    SCHEDULE_WINDOW_AFTER = timedelta(days=8)
    # AniList's recommendations for one title, kept a day (B18): they change slowly,
    # and every cold key would otherwise cost an interactive AniList call.
    ANILIST_RECOMMENDATIONS_TTL = 24 * 60 * 60

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

    @staticmethod
    def schedule_now() -> datetime:
        """The instant the schedule window and its cache key are computed from."""
        return timezone.now()

    def schedule_queryset(
        self, user, *, include_user_context: bool = True, now: datetime | None = None
    ):
        now = now or self.schedule_now()
        queryset = (
            Anime.public_queryset()
            .filter(status=Anime.AnimeStatus.airing)
            .filter(
                Q(
                    next_airing_date__gte=now - self.SCHEDULE_WINDOW_BEFORE,
                    next_airing_date__lte=now + self.SCHEDULE_WINDOW_AFTER,
                )
                # No date yet: placed by its weekly slot ("Time TBA" on the frontend).
                | Q(next_airing_date__isnull=True, broadcast_day__in=self.SCHEDULE_DAY_NAMES)
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
        # Airing times are Japanese broadcast times; in UTC, late-night JST shows shift a day back.
        localized = timezone.localtime(next_airing_date, local_tz)
        return cls.SCHEDULE_DAY_NAMES[(localized.weekday() + 1) % 7]

    def recommendations(self, anime, *, can_view_adult_content: bool = True):
        """``(queryset, degraded)``: ``degraded`` when AniList could not be asked.

        AniList's recommendations that exist locally, in AniList's order, or
        shared-genre recommendations when AniList has none in the catalog. A
        degraded answer is that fallback served because AniList was busy or
        down, so callers should not cache it like a real answer. Franchise
        entries (this anime's relations) are left out either way.
        """
        related_ids, related_anilist_ids = self._relation_targets(anime)
        degraded = False
        if anime.anilist_id or anime.mal_id:
            queryset, degraded = self._provider_recommendations_queryset(
                anime,
                can_view_adult_content=can_view_adult_content,
                related_ids=related_ids,
                related_anilist_ids=related_anilist_ids,
            )
            if queryset is not None and queryset.exists():
                return queryset, False

        fallback = self._fallback_recommendations_queryset(
            anime,
            can_view_adult_content=can_view_adult_content,
            related_ids=related_ids,
            related_anilist_ids=related_anilist_ids,
        )
        return fallback, degraded

    @classmethod
    def anilist_recommendations_cache_key(cls, anime) -> str:
        return f"anime_anilist_recommendations:v1:{anime.anilist_id or ''}:{anime.mal_id or ''}"

    def _anilist_recommendations(self, anime) -> tuple[list[dict], bool]:
        """``(recommendations, degraded)`` from AniList, a real answer kept for a day.

        The key is not in the collection namespace (which catalog syncs bump
        every hour) and holds only AniList's IDs, so both adult-content
        variants share it; the payload built from it is cached like a shelf.
        """
        cache_key = self.anilist_recommendations_cache_key(anime)
        cached = cache.get(cache_key)
        if isinstance(cached, list):
            return cached, False

        service = AniListService(enable_caching=True, enable_rate_limiting=True)
        try:
            recommendations = service.get_recommendations_for_anime(
                anime.anilist_id,
                mal_id=anime.mal_id,
                limit=12,
                request_budget=service.REQUEST_BUDGET_INTERACTIVE,
            )
            degraded = not recommendations and service.last_error_code in TRANSIENT_ERROR_CODES
        except Exception:
            logger.warning(
                "Failed to fetch AniList recommendations for %s", anime.slug, exc_info=True
            )
            recommendations, degraded = [], True
        finally:
            service.close()

        if not degraded:
            compact = [
                {"id": item.get("id"), "mal_id": item.get("mal_id")}
                for item in recommendations
                if isinstance(item, dict)
            ]
            cache.set(cache_key, compact, self.ANILIST_RECOMMENDATIONS_TTL)
        return recommendations, degraded

    def _provider_recommendations_queryset(
        self,
        anime,
        *,
        can_view_adult_content: bool,
        related_ids: list[int],
        related_anilist_ids: set[int],
    ):
        """``(queryset or None, degraded)`` for AniList's recommendations.

        AniList names a title by its AniList ID and its ``idMal``; both are
        matched against the catalog. Franchise entries are excluded by the
        relation's local anime or AniList ID.
        """
        recommendations, degraded = self._anilist_recommendations(anime)

        ordering_cases = []
        anilist_ids: list[int] = []
        mal_ids: list[int] = []
        for position, recommendation in enumerate(recommendations):
            rec_anilist_id = recommendation.get("id")
            rec_mal_id = recommendation.get("mal_id")
            if (rec_anilist_id and rec_anilist_id in {anime.anilist_id, *related_anilist_ids}) or (
                rec_mal_id and rec_mal_id == anime.mal_id
            ):
                continue
            if rec_anilist_id:
                anilist_ids.append(rec_anilist_id)
                ordering_cases.append(When(anilist_id=rec_anilist_id, then=Value(position)))
            if rec_mal_id:
                mal_ids.append(rec_mal_id)
                ordering_cases.append(When(mal_id=rec_mal_id, then=Value(position)))

        if not ordering_cases:
            return None, degraded

        ordering = Case(
            *ordering_cases, default=Value(len(recommendations)), output_field=IntegerField()
        )
        queryset = (
            self.shelf_queryset_for(can_view_adult_content)
            .filter(Q(anilist_id__in=anilist_ids) | Q(mal_id__in=mal_ids))
            .exclude(id__in=[anime.id, *related_ids])
            .annotate(recommendation_order=ordering)
            .order_by("recommendation_order", "-id")
        )
        return queryset, False

    @classmethod
    def _current_and_next_seasons(cls) -> tuple[str, int, str, int]:
        return cls.season_window_for_date(date.today())


class AnimePublicPayloadService:
    # v12: detail payloads carry is_adult (the D-2 gate reads it).
    PUBLIC_CACHE_VERSION = "v12"
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

    # A save that changes only these fields changes only the detail payload (no
    # card or shelf shows them), so it drops that one key instead of every
    # collection (B2). ``synopsis`` is left out on purpose, although the spec lists
    # it: the trending/top-rated shelves and the Home hero show it (SHELF_FIELDS).
    DETAIL_ONLY_FIELDS = frozenset(
        {
            "status_distribution",
            "external_links",
            "trailer_url",
            "theme_songs",
            "meta_description",
        }
    )
    # The query parameters a list response depends on (``ListFilterMixin`` and
    # the paginator). Anything else is ignored, so it cannot mint cache keys (B11).
    LIST_CACHE_SCALAR_PARAMS = (
        "q",
        "studio",
        "season",
        "year",
        "min_year",
        "max_year",
        "min_rating",
        "max_rating",
        "min_episodes",
        "max_episodes",
        "min_duration",
        "max_duration",
        "source",
        "shelf",
        "sort",
        "page",
        "page_size",
    )
    # Read stripped and lowercased by the filters, so normalised the same way in the
    # key. The others are kept as sent: the sort variants test their raw truthiness.
    LIST_CACHE_CASELESS_PARAMS = frozenset({"q", "shelf", "sort"})
    # Comma-separated sets whose order and case do not matter.
    LIST_CACHE_SET_PARAMS = ("tags", "type", "status")
    # Numbers the filters parse with this type: "7" and "7.0" are the same filter, and
    # every value that does not parse behaves alike (ignored, but still truthy for the
    # sort variants), so all of those share one marker.
    LIST_CACHE_NUMERIC_PARAMS: dict[str, type[int] | type[float]] = {
        "studio": int,
        "year": int,
        "min_year": int,
        "max_year": int,
        "min_rating": float,
        "max_rating": float,
        "min_episodes": int,
        "max_episodes": int,
        "min_duration": int,
        "max_duration": int,
    }
    UNPARSED_PARAM = "~"

    @classmethod
    def detail_cache_key(cls, slug: str) -> str:
        return f"anime_detail_base:{cls.PUBLIC_CACHE_VERSION}:{slug}"

    @classmethod
    def detail_cache_keys(cls, slug: str) -> tuple[str, ...]:
        """Every key that holds ``slug``'s detail payload (the legacy keys are gone)."""
        return (cls.detail_cache_key(slug),)

    @classmethod
    def schedule_cache_key(
        cls, day_key: str, can_view_adult_content: bool, *, now: datetime | None = None
    ) -> str:
        """``day_key`` is a lowercase day name, or ``"all"`` for the whole week.

        The UTC date stamp rolls the airing window over daily. Like every
        shelf, the key also carries the collection namespace when stored, so
        an anime save invalidates it through the namespace bump.
        """
        stamp = (now or AnimeQueryService.schedule_now()).astimezone(UTC).strftime("%Y%m%d")
        return (
            f"anime_schedule:{cls.PUBLIC_CACHE_VERSION}:day:{day_key}"
            f":adult:{int(can_view_adult_content)}:d:{stamp}"
        )

    @classmethod
    def list_cache_key_params(cls, query_params) -> dict[str, str | list]:
        """The known list parameters, normalised so equivalent requests share a key."""
        params: dict[str, str | list] = {}
        for name in cls.LIST_CACHE_SCALAR_PARAMS:
            value = query_params.get(name) or ""
            if name in cls.LIST_CACHE_CASELESS_PARAMS:
                value = value.strip().lower()
            if name == "q" and len(value) < MIN_SEARCH_LENGTH:
                value = ""  # the search filter ignores it too
            if value and name in cls.LIST_CACHE_NUMERIC_PARAMS:
                value = cls._canonical_number(value, cls.LIST_CACHE_NUMERIC_PARAMS[name])
            elif name == "page":
                value = cls._canonical_page(value)
            elif name == "page_size":
                value = cls._canonical_page_size(value)
            if value:
                params[name] = value
        for name in cls.LIST_CACHE_SET_PARAMS:
            raw = query_params.get(name)
            if raw:  # present, even if every part is blank: it still counts as a filter
                params[name] = sorted({part.strip().lower() for part in raw.split(",")} - {""})
        genres = sorted(
            set(AnimeQueryService._parse_multi_value_params(query_params.getlist("genre")))
        )
        if genres:
            params["genre"] = genres
        exclude_ids = AnimeQueryService.parse_exclude_ids(query_params.get("exclude_ids"))
        if exclude_ids:
            params["exclude_ids"] = sorted(set(exclude_ids))
        return params

    @classmethod
    def _canonical_number(cls, value: str, number_type: type[int] | type[float]) -> str:
        try:
            return str(number_type(value))
        except (TypeError, ValueError):
            return cls.UNPARSED_PARAM

    @classmethod
    def _canonical_page(cls, value: str) -> str:
        """Page 1 is the default; anything that is not a page number is a 404 (not cached)."""
        number = positive_int(value)
        if number is None:
            return cls.UNPARSED_PARAM if value else ""
        return "" if number == 1 else str(number)

    @staticmethod
    def _canonical_page_size(value: str) -> str:
        """As ``NoCountPagination`` reads it: clamped to its maximum; invalid means default."""
        number = positive_int(value)
        if number is None:
            return ""
        number = min(number, NoCountPagination.max_page_size)
        return "" if number == NoCountPagination.page_size else str(number)

    @classmethod
    def list_cache_key(cls, query_params, *, can_view_adult_content: bool) -> str:
        """The list payload's key (before the collection namespace), viewer-independent."""
        param_string = json.dumps(
            sorted(cls.list_cache_key_params(query_params).items()), separators=(",", ":")
        )
        digest = hashlib.sha256(param_string.encode()).hexdigest()
        return f"anime_list:{cls.PUBLIC_CACHE_VERSION}:adult:{int(can_view_adult_content)}:{digest}"

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
    def cache_list_payload(cls, request, build_payload, *, can_view_adult_content: bool):
        """The list page every viewer with this adult-content setting shares (B10).

        ``build_payload`` must build it without the viewer; signed-in callers add
        their own state afterwards (``enrich_list_payload_for_user``).
        """
        cache_key = cls._with_collection_namespace(
            cls.list_cache_key(request.query_params, can_view_adult_content=can_view_adult_content)
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

    @staticmethod
    def with_site_status_distribution(data):
        """Add this site's list counts (D-3), computed per request, never cached here.

        ``site_status_counts`` is G3's (``user_list_side_effects``); until it
        exists the field is null and this costs nothing.
        """
        if not isinstance(data, dict) or "id" not in data:
            return data
        from . import user_list_side_effects

        site_status_counts = getattr(user_list_side_effects, "site_status_counts", None)
        return {
            **data,
            "site_status_distribution": (
                site_status_counts(data["id"]) if site_status_counts is not None else None
            ),
        }

    @classmethod
    def get_detail_payload(cls, slug: str, request, query_service: AnimeQueryService):
        primary_cache_key = cls.detail_cache_key(slug)
        coverless_marker_key = f"{primary_cache_key}:coverless_checked"
        cache_status = "hit"
        cached_base = cache.get(primary_cache_key)

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
                invalidate_public_cache_keys(primary_cache_key)
            elif cache_payload_changed:
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

        data = cls.with_site_status_distribution(data)
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
    def enrich_list_payload_for_user(cls, data, user):
        """``enrich_collection_payload_for_user`` for a list page (paginated or not)."""
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return {
                **data,
                "results": cls.enrich_collection_payload_for_user(data["results"], user),
            }
        if isinstance(data, list):
            return cls.enrich_collection_payload_for_user(data, user)
        return data

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
        try:
            namespace = cache.get(cls.COLLECTION_CACHE_NAMESPACE_KEY)
            if namespace is None:
                namespace = "0"
                cache.set(cls.COLLECTION_CACHE_NAMESPACE_KEY, namespace, None)
        except CACHE_ERRORS:
            # The cache is down: the payload read after this bypasses it too.
            warn_cache_outage("catalog cache namespace")
            return CACHE_OUTAGE_VERSION
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


# --- Cross-group invalidation contract (G2; overview section 5) ---------------
# Other groups call these instead of saving the Anime row to flush its caches.
# An ``Anime`` save does the same through ``signals``: a save of detail-only
# fields calls the first, any other save both (P0-2).


def invalidate_anime_detail(slug: str) -> None:
    """Drop one anime's cached detail payload; every collection stays cached.

    For changes only the detail page shows (review counts, status counts,
    external links...). Its cards in lists and shelves are untouched (a synopsis
    is on the shelves: use ``invalidate_public_collections`` too).

    It runs at once: inside a transaction, call it from
    ``transaction.on_commit``, or a reader can cache the old row again before
    the commit.
    """
    invalidate_public_cache_keys(*AnimePublicPayloadService.detail_cache_keys(slug))


def invalidate_public_collections() -> None:
    """Invalidate every cached public collection (lists, shelves, browse rows, schedule).

    Runs at once, like ``invalidate_anime_detail``: defer it to the commit.
    """
    AnimePublicPayloadService.bump_collection_cache_namespace()
