from django.db import transaction
from django.db.models import Q
from django_filters import BooleanFilter, CharFilter, ChoiceFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import (
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.response import Response
from rest_framework.serializers import BooleanField, Serializer
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from ...animes.admin_serializers import (
    AdminAnimeDetailSerializer,
    AdminAnimeSerializer,
    AdminCharacterSerializer,
    AdminGenreSerializer,
    AdminStaffSerializer,
    AdminStudioSerializer,
)
from ...animes.models import Anime
from ..permissions import AdminPolicyMixin
from ..services.anime_admin_service import (
    AnimeTaskError,
    delete_genre,
    delete_studio,
    get_admin_anime_queryset,
    get_admin_character_queryset,
    get_admin_genre_queryset,
    get_admin_staff_queryset,
    get_admin_studio_queryset,
    queue_anime_image_refetch,
    queue_anime_refresh,
)
from .audit_mixins import AuditedModelViewSetMixin

MISSING_FILTERS = {
    "cover": Q(cover_image="") | Q(cover_image__isnull=True),
    "synopsis": Q(synopsis="") | Q(synopsis__isnull=True),
    "anilist_id": Q(anilist_id__isnull=True),
    "studio": Q(studio_links__isnull=True),
}


class AnimeFilter(FilterSet):
    status = CharFilter(field_name="status")
    type = CharFilter(field_name="anime_type")
    is_adult = BooleanFilter(field_name="is_adult")
    season = CharFilter(field_name="season")
    season_year = NumberFilter(field_name="season_year")
    anilist_id = NumberFilter(field_name="anilist_id")
    missing = ChoiceFilter(choices=[(key, key) for key in MISSING_FILTERS], method="filter_missing")

    class Meta:
        model = Anime
        fields = ["status", "anime_type", "is_adult", "season", "season_year", "anilist_id"]

    def filter_missing(self, queryset, name, value):
        missing = MISSING_FILTERS[value]
        if value == "cover":
            missing &= Q(cover_image_external_url="")
        return queryset.filter(missing)


class ForceQuerySerializer(Serializer):
    force = BooleanField(required=False, default=False)


class AdminAnimeViewSet(
    AdminPolicyMixin,
    AuditedModelViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """Anime: staff read; superusers edit the SEO text, refresh from AniList, delete."""

    serializer_class = AdminAnimeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AnimeFilter
    search_fields = ["title", "title_jp"]
    ordering_fields = [
        "title",
        "created_at",
        "updated_at",
        "rating",
        "release_date",
        "popularity_rank",
        "member_count",
    ]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return get_admin_anime_queryset(detail=self.action != "list")

    def get_serializer_class(self):
        return AdminAnimeSerializer if self.action == "list" else AdminAnimeDetailSerializer

    def _queue(self, operation, anime):
        try:
            payload = operation(self.request, anime)
        except AnimeTaskError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response(payload, status=202)

    @action(detail=True, methods=["post"])
    def refresh(self, request, pk=None):
        """Queue an AniList metadata refresh of this anime."""
        return self._queue(queue_anime_refresh, self.get_object())

    @action(detail=True, methods=["post"])
    def refetch_images(self, request, pk=None):
        """Download the cover and banner again from their external URLs."""
        return self._queue(queue_anime_image_refetch, self.get_object())

    def destroy(self, request, *args, **kwargs):
        """Delete an anime."""
        anime = self.get_object()
        title = anime.title
        self.perform_destroy(anime)
        return Response({"message": f"Anime '{title}' deleted successfully."})


class AdminGenreViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    """Genre management for admins."""

    serializer_class = AdminGenreSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return get_admin_genre_queryset()

    def destroy(self, request, *args, **kwargs):
        """Delete a genre. Checks for existing anime references."""
        genre = self.get_object()
        query_serializer = ForceQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        force = query_serializer.validated_data["force"]
        with transaction.atomic():
            if genre.anime_count == 0 or force:
                self.audit_destroy(genre, {"anime_count": genre.anime_count, "force": force})
            result = delete_genre(genre, force)
        return Response(result.payload, status=result.status_code)


class AdminStudioViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    """Studio management for admins."""

    serializer_class = AdminStudioSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name"]

    def get_queryset(self):
        return get_admin_studio_queryset()

    def destroy(self, request, *args, **kwargs):
        """Delete a studio. Prevents deletion if > 0 anime assigned."""
        studio = self.get_object()
        query_serializer = ForceQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        force = query_serializer.validated_data["force"]
        with transaction.atomic():
            if studio.anime_count == 0 or force:
                self.audit_destroy(studio, {"anime_count": studio.anime_count, "force": force})
            result = delete_studio(studio, force)
        return Response(result.payload, status=result.status_code)


class AdminCharacterViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    """Character management for admins."""

    serializer_class = AdminCharacterSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return get_admin_character_queryset()


class AdminStaffViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    """Staff management for admins."""

    serializer_class = AdminStaffSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return get_admin_staff_queryset()
