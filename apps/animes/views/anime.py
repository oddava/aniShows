from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from ...core.api_errors import error_response
from ...core.permissions import IsSuperUser
from ...core.utils import get_client_ip
from ...shared.logger import logger
from ...shared.pagination import NoCountPagination, StandardPagination
from ...shared.public_cache import get_or_build_public_payload
from ...users.permissions import VerifiedEmailForWrites
from ..models import Anime, AnimeCharacter, AnimeStaff, Genre, Studio
from ..serializers import (
    AnimeCharacterSerializer,
    AnimeDetailSerializer,
    AnimeListSerializer,
    AnimeShelfSerializer,
    AnimeStaffSerializer,
    AnimeWatchEpisodeSerializer,
    EpisodeRatingInputSerializer,
    EpisodeRatingSummarySerializer,
    GenreSerializer,
    ReviewSerializer,
    StudioSerializer,
)
from ..services.episode_ratings import (
    EpisodeRatingCommandService,
    EpisodeRatingSummaryService,
)
from ..services.franchise_import import FranchiseImportError, FranchiseImportService
from ..services.public_anime_service import (
    AnimePublicPayloadService,
    AnimeQueryService,
)
from ..services.watch_episodes import AnimeWatchEpisodeService


class WatchEpisodesPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AnimeDetailRelationPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class AnimeViewSet(ReadOnlyModelViewSet):
    serializer_class = AnimeListSerializer
    lookup_field = "slug"
    pagination_class = NoCountPagination
    franchise_import_service = FranchiseImportService()
    payload_service = AnimePublicPayloadService()
    query_service = AnimeQueryService()
    PUBLIC_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=900"

    @classmethod
    def _with_public_cache_control(cls, response: Response, request) -> Response:
        if not request.user.is_authenticated:
            response["Cache-Control"] = cls.PUBLIC_CACHE_CONTROL
        return response

    @staticmethod
    def _with_cache_status_header(response: Response, cache_status: str) -> Response:
        response["X-Cache-Status"] = cache_status
        return response

    def _build_queryset(self, *, include_user_context: bool = True):
        return self.query_service.build_queryset(
            self.request,
            action=self.action,
            include_user_context=include_user_context,
        )

    def get_queryset(self):
        return self._build_queryset(include_user_context=True)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AnimeDetailSerializer
        return super().get_serializer_class()

    def retrieve(self, request, *args, **kwargs):
        slug = kwargs.get("slug")
        try:
            result = self.payload_service.get_detail_payload(slug, request, self.query_service)
        except Anime.DoesNotExist:
            return error_response(
                "Anime not found",
                code="anime_not_found",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        except Exception as exc:
            logger.error("Error retrieving anime %s: %s", slug, exc)
            return error_response(
                "Internal server error",
                code="internal_server_error",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        response = self._with_cache_status_header(Response(result.data), result.cache_status)
        return self._with_public_cache_control(response, request)

    def _get_action_anime(self, slug: str) -> Anime:
        return get_object_or_404(
            Anime.public_queryset().only(*self.query_service.ACTION_ANIME_ONLY_FIELDS),
            slug=slug,
        )

    def list(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            queryset = self.filter_queryset(self.get_queryset())
            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                data = self.payload_service.enrich_collection_payload_for_user(
                    serializer.data,
                    request.user,
                )
                return self.get_paginated_response(data)
            serializer = self.get_serializer(queryset, many=True)
            data = self.payload_service.enrich_collection_payload_for_user(
                serializer.data,
                request.user,
            )
            return Response(data)
        result = self.payload_service.cache_list_payload(
            request,
            lambda: super(AnimeViewSet, self).list(request, *args, **kwargs).data,
        )
        response = self._with_cache_status_header(Response(result.data), result.cache_status)
        return self._with_public_cache_control(response, request)

    def _get_cached_shelf(self, request, cache_key: str, queryset_fn):
        result = self.payload_service.cache_shelf_payload(
            cache_key,
            lambda: AnimeShelfSerializer(
                queryset_fn(self.query_service.base_shelf_queryset()),
                many=True,
                context={"request": request},
            ).data,
        )
        data = self.payload_service.enrich_collection_payload_for_user(result.data, request.user)
        response = self._with_cache_status_header(Response(data), result.cache_status)
        return self._with_public_cache_control(response, request)

    @action(detail=False, methods=["get"])
    def trending(self, request):
        return self._get_cached_shelf(
            request,
            f"anime_trending:{self.payload_service.PUBLIC_CACHE_VERSION}",
            lambda qs: qs.filter(trending_rank__isnull=False).order_by("trending_rank")[:12],
        )

    @action(detail=False, methods=["get"])
    def top_rated(self, request):
        can_view_adult_content = self.query_service.can_view_adult_content(request.user)
        return self._get_cached_shelf(
            request,
            f"anime_top_rated:{self.payload_service.PUBLIC_CACHE_VERSION}",
            lambda _qs: self.query_service.browse_row_queryset(
                can_view_adult_content=can_view_adult_content,
                sort="rating",
                limit=12,
            ),
        )

    @action(detail=False, methods=["get"])
    def schedule(self, request):
        requested_day = self.query_service.normalize_schedule_day(request.query_params.get("day"))
        if request.query_params.get("day") and requested_day is None:
            return error_response(
                "Invalid schedule day.",
                code="invalid_schedule_day",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        anime_list = list(self.query_service.schedule_queryset(request.user, include_user_context=True))
        serializer = AnimeListSerializer(anime_list, many=True, context={"request": request})
        schedule_days = {day.lower(): [] for day in self.query_service.SCHEDULE_DAY_NAMES}
        resolved_days = {
            anime.id: self.query_service.resolve_schedule_day(anime)
            for anime in anime_list
        }

        for item in serializer.data:
            schedule_day = resolved_days.get(item["id"])
            if schedule_day:
                schedule_days[schedule_day.lower()].append(item)

        if requested_day:
            key = requested_day.lower()
            response = Response({"day": key, "items": schedule_days[key], "count": len(schedule_days[key])})
            return self._with_public_cache_control(response, request)

        response = Response(
            {
                "days": schedule_days,
                "counts": {day: len(items) for day, items in schedule_days.items()},
                "total": sum(len(items) for items in schedule_days.values()),
            }
        )
        return self._with_public_cache_control(response, request)

    @action(detail=False, methods=["get"], url_path="browse-rows")
    def browse_rows(self, request):
        can_view_adult_content = self.query_service.can_view_adult_content(request.user)
        cache_key = (
            f"anime_browse_rows:{self.payload_service.PUBLIC_CACHE_VERSION}:"
            f"adult:{int(can_view_adult_content)}"
        )

        def build_payload():
            rows = []
            row_definitions = self.query_service.browse_row_definitions(
                can_view_adult_content=can_view_adult_content
            )
            for row in row_definitions:
                # Serialize one combined browse payload so the default page avoids five separate cold starts.
                rows.append(
                    {
                        "key": row["key"],
                        "title": row["title"],
                        "browse_params": row["browse_params"],
                        "anime_list": AnimeListSerializer(
                            row["queryset"],
                            many=True,
                            context={"request": request},
                        ).data,
                    }
                )
            return rows

        result = self.payload_service.cache_shelf_payload(cache_key, build_payload)
        data = self.payload_service.enrich_browse_rows_payload_for_user(result.data, request.user)
        response = self._with_cache_status_header(Response(data), result.cache_status)
        return self._with_public_cache_control(response, request)

    @action(
        detail=True,
        methods=["get"],
        serializer_class=ReviewSerializer,
        pagination_class=StandardPagination,
    )
    def reviews(self, request, slug=None):
        from ..services.reviews import get_review_queryset

        anime = self.get_object()
        reviews = get_review_queryset(request.user, request.query_params).filter(anime=anime)
        page = self.paginate_queryset(reviews)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"])
    def related(self, request, slug=None):
        anime = self.get_object()
        cache_key = f"anime_related:{self.payload_service.PUBLIC_CACHE_VERSION}:{anime.slug}"
        result = self.payload_service.cache_shelf_payload(
            cache_key,
            lambda: AnimeListSerializer(
                self.query_service.related_queryset(anime),
                many=True,
                context={"request": request},
            ).data,
        )
        data = self.payload_service.enrich_collection_payload_for_user(result.data, request.user)
        response = self._with_cache_status_header(Response(data), result.cache_status)
        return self._with_public_cache_control(response, request)

    @action(detail=True, methods=["get"])
    def recommendations(self, request, slug=None):
        anime = self.get_object()
        cache_key = (
            f"anime_recommendations:{self.payload_service.PUBLIC_CACHE_VERSION}:{anime.slug}"
        )
        result = self.payload_service.cache_shelf_payload(
            cache_key,
            lambda: AnimeListSerializer(
                self.query_service.recommendations_queryset(anime),
                many=True,
                context={"request": request},
            ).data,
        )
        data = self.payload_service.enrich_collection_payload_for_user(result.data, request.user)
        response = self._with_cache_status_header(Response(data), result.cache_status)
        return self._with_public_cache_control(response, request)

    @action(detail=True, methods=["get"])
    def characters(self, request, slug=None):
        instance = self._get_action_anime(slug)
        characters = (
            AnimeCharacter.objects.filter(anime=instance)
            .select_related("character", "voice_actor")
            .only(
                "id",
                "anime_id",
                "role",
                "character_id",
                "voice_actor_id",
                "character__id",
                "character__name",
                "character__name_native",
                "character__image",
                "character__image_url",
                "voice_actor__id",
                "voice_actor__name",
                "voice_actor__name_native",
                "voice_actor__image",
                "voice_actor__image_url",
            )
            .order_by("role", "character__name", "id")
        )
        paginator = AnimeDetailRelationPagination()
        page = paginator.paginate_queryset(characters, request, view=self)
        serializer = AnimeCharacterSerializer(page, many=True)
        response = paginator.get_paginated_response(serializer.data)
        return self._with_public_cache_control(response, request)

    @action(detail=True, methods=["get"])
    def staff(self, request, slug=None):
        instance = self._get_action_anime(slug)
        staff = (
            AnimeStaff.objects.filter(anime=instance)
            .select_related("staff")
            .only(
                "id",
                "anime_id",
                "role",
                "staff_id",
                "staff__id",
                "staff__name",
                "staff__name_native",
                "staff__image",
                "staff__image_url",
            )
            .order_by("id")
        )
        paginator = AnimeDetailRelationPagination()
        page = paginator.paginate_queryset(staff, request, view=self)
        serializer = AnimeStaffSerializer(page, many=True)
        response = paginator.get_paginated_response(serializer.data)
        return self._with_public_cache_control(response, request)

    @action(detail=True, methods=["get"], url_path="watch-episodes")
    def watch_episodes(self, request, slug=None):
        anime = self._get_action_anime(slug)
        episodes = AnimeWatchEpisodeService().get_for_anime(
            anime,
            request_budget=AnimeWatchEpisodeService.REQUEST_BUDGET_INTERACTIVE,
        )
        paginator = WatchEpisodesPagination()
        page = paginator.paginate_queryset(episodes, request, view=self)
        episode_numbers = [episode.get("number") for episode in (page or [])]
        episode_rating_map = {
            item["episode_number"]: item
            for item in EpisodeRatingSummaryService().get_for_anime(
                anime,
                user=request.user,
                episode_numbers=episode_numbers,
            )
        }
        enriched_episodes = [
            {
                **episode,
                "average_rating": (episode_rating_map.get(episode["number"]) or {}).get(
                    "average_rating"
                ),
                "rating_count": int(
                    (episode_rating_map.get(episode["number"]) or {}).get("rating_count") or 0
                ),
                "user_rating": (episode_rating_map.get(episode["number"]) or {}).get(
                    "user_rating"
                ),
            }
            for episode in (page or [])
        ]
        serializer = AnimeWatchEpisodeSerializer(enriched_episodes, many=True)
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="episode-ratings")
    def episode_ratings(self, request, slug=None):
        anime = self._get_action_anime(slug)
        ratings = EpisodeRatingSummaryService().get_for_anime(anime, user=request.user)
        serializer = EpisodeRatingSummarySerializer(ratings, many=True)
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["put", "patch", "delete"],
        url_path=r"episode-ratings/(?P<episode_number>\d+)",
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
    )
    def episode_rating(self, request, slug=None, episode_number=None):
        anime = self._get_action_anime(slug)
        resolved_episode_number = int(episode_number)
        command_service = EpisodeRatingCommandService()

        try:
            if request.method == "DELETE":
                summary, status_code = command_service.delete(
                    anime=anime,
                    user=request.user,
                    episode_number=resolved_episode_number,
                )
            else:
                serializer = EpisodeRatingInputSerializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                summary, status_code = command_service.upsert(
                    anime=anime,
                    user=request.user,
                    episode_number=resolved_episode_number,
                    rating=serializer.validated_data["rating"],
                )
        except ValueError as exc:
            return error_response(
                str(exc),
                code="invalid_episode_number",
                status_code=status.HTTP_400_BAD_REQUEST,
                errors={"episode_number": [str(exc)]},
            )

        response_serializer = EpisodeRatingSummarySerializer(summary)
        return Response(response_serializer.data, status=status_code)

    @action(
        detail=False,
        methods=["post"],
        url_path="franchise/fetch",
        permission_classes=[IsSuperUser],
    )
    def franchise_fetch(self, request):
        provider_ids = {}
        for field in ("anilist_id", "mal_id"):
            raw_value = request.data.get(field)
            if raw_value in (None, ""):
                continue
            try:
                provider_ids[field] = int(raw_value)
            except (ValueError, TypeError):
                return error_response(
                    f"{field} must be a valid integer",
                    code=f"invalid_{field}",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
        if not provider_ids:
            return error_response(
                "anilist_id or mal_id is required",
                code="missing_anilist_id",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client_ip = get_client_ip(request)
            result = self.franchise_import_service.import_related_anime(
                **provider_ids,
                client_ip=client_ip,
                source_slug=request.data.get("source_slug"),
                rate_limit_key=f"user:{request.user.pk}:{client_ip}",
            )
            return Response(
                {
                    "slug": result.slug,
                    "title": result.title,
                    "imported": result.imported,
                }
            )
        except FranchiseImportError as exc:
            return error_response(
                exc.message,
                code="franchise_import_failed",
                status_code=exc.status_code,
            )


class GenreViewSet(ReadOnlyModelViewSet):
    queryset = Genre.objects.only("id", "name", "slug").order_by("name")
    serializer_class = GenreSerializer
    pagination_class = None

    def list(self, request, *args, **kwargs):
        data, cache_status = get_or_build_public_payload(
            "anime_genres:v1",
            # Use an explicit super() target because the cache builder runs in a nested callable.
            lambda: super(GenreViewSet, self).list(request, *args, **kwargs).data,
            ttl=3600,
        )
        response = Response(data)
        response["X-Cache-Status"] = cache_status
        response["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=900"
        return response


class StudioViewSet(ReadOnlyModelViewSet):
    queryset = Studio.objects.only("id", "name", "website").order_by("name")
    serializer_class = StudioSerializer
    pagination_class = None

    def list(self, request, *args, **kwargs):
        data, cache_status = get_or_build_public_payload(
            "anime_studios:v1",
            # Use an explicit super() target because the cache builder runs in a nested callable.
            lambda: super(StudioViewSet, self).list(request, *args, **kwargs).data,
            ttl=3600,
        )
        response = Response(data)
        response["X-Cache-Status"] = cache_status
        response["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=900"
        return response
