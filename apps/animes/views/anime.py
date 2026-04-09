from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet
from rest_framework_simplejwt.authentication import JWTAuthentication

from ...core.utils import get_client_ip
from ...shared.logger import logger
from ..models import Anime, AnimeCharacter, AnimeStaff, Genre, Studio
from ..serializers import (
    AnimeCharacterSerializer,
    AnimeDetailSerializer,
    AnimeListSerializer,
    ReviewSerializer,
    AnimeStaffSerializer,
    AnimeWatchEpisodeSerializer,
    EpisodeRatingInputSerializer,
    EpisodeRatingSummarySerializer,
    GenreSerializer,
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
from ...shared.pagination import NoCountPagination


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return


class WatchEpisodesPagination(PageNumberPagination):
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
            return Response({"error": "Anime not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            logger.error("Error retrieving anime %s: %s", slug, exc)
            return Response(
                {"error": "Internal server error"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return self._with_cache_status_header(Response(result.data), result.cache_status)

    def _get_action_anime(self, slug: str) -> Anime:
        return get_object_or_404(Anime.public_queryset(), slug=slug)

    def list(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return super().list(request, *args, **kwargs)
        result = self.payload_service.cache_list_payload(
            request,
            lambda: super(AnimeViewSet, self).list(request, *args, **kwargs).data,
        )
        return self._with_cache_status_header(Response(result.data), result.cache_status)

    def _get_cached_shelf(self, request, cache_key: str, queryset_fn):
        result = self.payload_service.cache_shelf_payload(
            cache_key,
            lambda: AnimeListSerializer(
                queryset_fn(self.query_service.base_shelf_queryset()),
                many=True,
                context={"request": request},
            ).data,
        )
        data = self.payload_service.enrich_collection_payload_for_user(result.data, request.user)
        return self._with_cache_status_header(Response(data), result.cache_status)

    @action(detail=False, methods=["get"])
    def trending(self, request):
        return self._get_cached_shelf(
            request,
            f"anime_trending:{self.payload_service.PUBLIC_CACHE_VERSION}",
            lambda qs: qs.filter(trending_rank__isnull=False).order_by("trending_rank")[:12],
        )

    @action(detail=False, methods=["get"])
    def top_rated(self, request):
        return self._get_cached_shelf(
            request,
            f"anime_top_rated:{self.payload_service.PUBLIC_CACHE_VERSION}",
            lambda qs: qs.filter(rating__isnull=False).order_by("-rating")[:12],
        )

    @action(detail=True, methods=["get"], serializer_class=ReviewSerializer)
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
        return self._with_cache_status_header(Response(data), result.cache_status)

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
        return self._with_cache_status_header(Response(data), result.cache_status)

    @action(detail=True, methods=["get"])
    def characters(self, request, slug=None):
        instance = self._get_action_anime(slug)
        characters = AnimeCharacter.objects.filter(anime=instance).select_related(
            "character",
            "voice_actor",
        )
        serializer = AnimeCharacterSerializer(characters, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def staff(self, request, slug=None):
        instance = self._get_action_anime(slug)
        staff = AnimeStaff.objects.filter(anime=instance).select_related("staff")
        serializer = AnimeStaffSerializer(staff, many=True)
        return Response(serializer.data)

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
        permission_classes=[IsAuthenticated],
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
            return Response(
                {"episode_number": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response_serializer = EpisodeRatingSummarySerializer(summary)
        return Response(response_serializer.data, status=status_code)

    @action(
        detail=False,
        methods=["post"],
        url_path="franchise/fetch",
        permission_classes=[IsAuthenticated],
        authentication_classes=[JWTAuthentication, CsrfExemptSessionAuthentication],
    )
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
            client_ip = get_client_ip(request)
            result = self.franchise_import_service.import_from_anilist(
                anilist_id=anilist_id,
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
            return Response({"error": exc.message}, status=exc.status_code)


class GenreViewSet(ReadOnlyModelViewSet):
    queryset = Genre.objects.only("id", "name", "slug").order_by("name")
    serializer_class = GenreSerializer
    pagination_class = None


class StudioViewSet(ReadOnlyModelViewSet):
    queryset = Studio.objects.only("id", "name", "website").order_by("name")
    serializer_class = StudioSerializer
    pagination_class = None
