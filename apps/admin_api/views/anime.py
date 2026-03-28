from django.db import transaction
from django.db.models import Avg, Count
from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from apps.animes.admin_serializers import (
    AdminAnimeSerializer,
    AdminCharacterSerializer,
    AdminGenreSerializer,
    AdminOfflineAnimeSyncStateSerializer,
    AdminStaffSerializer,
    AdminStudioSerializer,
)
from apps.animes.models import Anime, Character, Genre, OfflineAnimeSyncState, Staff, Studio
from apps.animes.services.offline_sync import OfflineSyncService
from apps.core.permissions import IsAdminUser


class AnimeFilter(FilterSet):
    status = CharFilter(field_name='status')
    type = CharFilter(field_name='anime_type')
    class Meta:
        model = Anime
        fields = ['status', 'anime_type']


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
        return Anime.objects.prefetch_related("genres").select_related("studio").annotate(
            favorites_count=Count("favorites"),
            reviews_count=Count("reviews"),
            avg_review_rating=Avg("reviews__rating")
        )

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
        return Genre.objects.annotate(anime_count=Count("anime")).order_by("name")

    def perform_create(self, serializer):
        name = serializer.validated_data.get('name')
        slug = serializer.validated_data.get('slug')
        if not slug:
            serializer.validated_data['slug'] = name.lower().replace(" ", "-")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        """Delete a genre. Checks for existing anime references."""
        genre = self.get_object()

        if genre.anime_count > 0 and not request.query_params.get("force"):
            return Response(
                {
                    "detail": f"Cannot delete genre with {genre.anime_count} associated anime. Use ?force=true to delete anyway.",
                    "anime_count": genre.anime_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = genre.name
        self.perform_destroy(genre)

        return Response({"message": f"Genre '{name}' deleted successfully."})


class AdminStudioViewSet(ModelViewSet):
    """Studio management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminStudioSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        return Studio.objects.annotate(anime_count=Count("anime")).order_by("name")

    def destroy(self, request, *args, **kwargs):
        """Delete a studio. Prevents deletion if > 0 anime assigned."""
        studio = self.get_object()

        if studio.anime_count > 0 and not request.query_params.get("force"):
            return Response(
                {
                    "detail": f"Cannot delete studio with {studio.anime_count} associated anime. Use ?force=true to delete anyway.",
                    "anime_count": studio.anime_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = studio.name
        self.perform_destroy(studio)

        return Response({"message": f"Studio '{name}' deleted successfully."})


class AdminCharacterViewSet(ModelViewSet):
    """Character management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminCharacterSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return Character.objects.annotate(anime_count=Count("animes", distinct=True))


class AdminStaffViewSet(ModelViewSet):
    """Staff management for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminStaffSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "name_native", "description"]
    ordering_fields = ["name", "anilist_id", "id"]
    ordering = ["name"]

    def get_queryset(self):
        return Staff.objects.annotate(anime_count=Count("animes", distinct=True))


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
        queryset = OfflineAnimeSyncState.objects.select_related("anime")
        quarantined = self.request.query_params.get("quarantined", "true").strip().lower()
        if quarantined in {"1", "true", "yes", "on"}:
            queryset = queryset.filter(quarantined=True)
        elif quarantined in {"0", "false", "no", "off"}:
            queryset = queryset.filter(quarantined=False)

        reason = self.request.query_params.get("reason")
        if reason:
            queryset = queryset.filter(quarantine_reason=reason)

        stage = self.request.query_params.get("stage")
        stage_status = self.request.query_params.get("status")
        if stage in {"metadata", "franchise", "themes"} and stage_status:
            queryset = queryset.filter(**{f"{stage}_status": stage_status})

        return queryset.order_by(*self.ordering)

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
        anime = state.anime

        anilist_id = self._parse_int_or_none(request.data.get("anilist_id"))
        mal_id = self._parse_int_or_none(request.data.get("mal_id"))
        if anilist_id is None and mal_id is None:
            return Response(
                {"detail": "Provide at least one of anilist_id or mal_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            anime = Anime.objects.select_for_update().get(id=anime.id)

            if anilist_id is not None:
                conflict = Anime.objects.filter(anilist_id=anilist_id).exclude(id=anime.id).first()
                if conflict:
                    return Response(
                        {
                            "detail": (
                                f"AniList ID {anilist_id} already belongs to anime #{conflict.id}."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                anime.anilist_id = anilist_id

            if mal_id is not None:
                conflict = Anime.objects.filter(mal_id=mal_id).exclude(id=anime.id).first()
                if conflict:
                    return Response(
                        {"detail": f"MAL ID {mal_id} already belongs to anime #{conflict.id}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                anime.mal_id = mal_id

            anime.save(update_fields=["anilist_id", "mal_id", "updated_at"])

        OfflineSyncService().reset_for_retry(state)
        state.refresh_from_db()
        return Response(self.get_serializer(state).data)

    @action(detail=True, methods=["post"])
    def merge_target(self, request, pk=None):
        state = self.get_object()
        target_anime_id = self._parse_int_or_none(request.data.get("target_anime_id"))
        if target_anime_id is None:
            return Response(
                {"detail": "target_anime_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if target_anime_id == state.anime_id:
            return Response(
                {"detail": "target_anime_id must be different from current anime."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not Anime.objects.filter(id=target_anime_id).exists():
            return Response(
                {"detail": f"Target anime #{target_anime_id} was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        reason = f"merged_into:{target_anime_id}"
        OfflineSyncService().mark_skipped(state, reason=reason)
        OfflineAnimeSyncState.objects.filter(id=state.id).update(
            quarantine_context={
                "manual": True,
                "action": "merge_target",
                "target_anime_id": target_anime_id,
            }
        )
        state.refresh_from_db()
        return Response(self.get_serializer(state).data)
