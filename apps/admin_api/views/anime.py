from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.serializers import BooleanField, Serializer
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from ...animes.admin_serializers import (
    AdminAnimeSerializer,
    AdminCharacterSerializer,
    AdminGenreSerializer,
    AdminOfflineAnimeSyncStateSerializer,
    AdminStaffSerializer,
    AdminStudioSerializer,
)
from ...animes.models import Anime
from ...animes.services.offline_sync import OfflineSyncService
from ...core.permissions import IsAdminUser
from ..services.anime_admin_service import (
    apply_default_genre_slug,
    delete_genre,
    delete_studio,
    get_admin_anime_queryset,
    get_admin_character_queryset,
    get_admin_genre_queryset,
    get_admin_offline_sync_state_queryset,
    get_admin_staff_queryset,
    get_admin_studio_queryset,
    mark_merge_target,
    set_ids_and_retry,
)


class AnimeFilter(FilterSet):
    status = CharFilter(field_name="status")
    type = CharFilter(field_name="anime_type")

    class Meta:
        model = Anime
        fields = ["status", "anime_type"]


class ForceQuerySerializer(Serializer):
    force = BooleanField(required=False, default=False)


class AdminAnimeViewSet(ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet):
    """Anime management for admins utilizing DRF GenericViewSet."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminAnimeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AnimeFilter
    search_fields = ['title', 'title_jp']
    ordering_fields = ['title', 'created_at', 'rating', 'release_date']
    ordering = ['-created_at']

    def get_queryset(self):
        return get_admin_anime_queryset()

    def destroy(self, request, *args, **kwargs):
        """Delete an anime."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete anime."},
                status=status.HTTP_403_FORBIDDEN,
            )

        anime = self.get_object()
        title = anime.title
        self.perform_destroy(anime)
        return Response({"message": f"Anime '{title}' deleted successfully."})


class AdminGenreViewSet(ModelViewSet):
    """Genre management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminGenreSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        return get_admin_genre_queryset()

    def perform_create(self, serializer):
        apply_default_genre_slug(serializer)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        """Delete a genre. Checks for existing anime references."""
        genre = self.get_object()
        query_serializer = ForceQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        result = delete_genre(genre, query_serializer.validated_data["force"])
        return Response(result.payload, status=result.status_code)


class AdminStudioViewSet(ModelViewSet):
    """Studio management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminStudioSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        return get_admin_studio_queryset()

    def destroy(self, request, *args, **kwargs):
        """Delete a studio. Prevents deletion if > 0 anime assigned."""
        studio = self.get_object()
        query_serializer = ForceQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        result = delete_studio(studio, query_serializer.validated_data["force"])
        return Response(result.payload, status=result.status_code)


class AdminCharacterViewSet(ModelViewSet):
    """Character management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminCharacterSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return get_admin_character_queryset()


class AdminStaffViewSet(ModelViewSet):
    """Staff management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminStaffSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return get_admin_staff_queryset()


class AdminOfflineAnimeSyncStateViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = AdminOfflineAnimeSyncStateSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["anime__title", "anime__slug", "quarantine_reason", "last_error_code"]
    ordering_fields = [
        "next_attempt_at",
        "last_attempt_at",
        "attempt_count",
        "created_at",
        "updated_at",
    ]
    ordering = ["next_attempt_at", "id"]

    def _parse_int_or_none(self, value):
        if value in (None, ""):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def get_queryset(self):
        return get_admin_offline_sync_state_queryset(self.request.query_params, self.ordering)

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        state = self.get_object()
        OfflineSyncService().reset_for_retry(state)
        state.refresh_from_db()
        return Response(self.get_serializer(state).data)

    @action(detail=True, methods=["post"])
    def mark_skipped(self, request, pk=None):
        state = self.get_object()
        reason = (request.data.get("reason") or "marked_skipped").strip()[:120]
        OfflineSyncService().mark_skipped(state, reason=reason)
        state.refresh_from_db()
        return Response(self.get_serializer(state).data)

    @action(detail=True, methods=["post"])
    def set_ids_and_retry(self, request, pk=None):
        state = self.get_object()
        anilist_id = self._parse_int_or_none(request.data.get("anilist_id"))
        mal_id = self._parse_int_or_none(request.data.get("mal_id"))
        result = set_ids_and_retry(state, anilist_id, mal_id)
        if result.status_code != 200:
            return Response(result.payload, status=result.status_code)
        return Response(self.get_serializer(result.payload["state"]).data)

    @action(detail=True, methods=["post"])
    def merge_target(self, request, pk=None):
        state = self.get_object()
        target_anime_id = self._parse_int_or_none(request.data.get("target_anime_id"))
        result = mark_merge_target(state, target_anime_id)
        if result.status_code != 200:
            return Response(result.payload, status=result.status_code)
        return Response(self.get_serializer(result.payload["state"]).data)
