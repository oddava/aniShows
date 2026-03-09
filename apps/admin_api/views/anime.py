from django.db.models import Avg, Count
from django_filters import CharFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from apps.animes.admin_serializers import (
    AdminAnimeSerializer,
    AdminGenreSerializer,
    AdminStudioSerializer,
)
from apps.animes.models import Anime, Genre, Studio
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination


class AnimeFilter(FilterSet):
    status = CharFilter(field_name='status')
    type = CharFilter(field_name='anime_type')
    class Meta:
        model = Anime
        fields = ['status', 'anime_type']


class AdminAnimeViewSet(ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet):
    """Anime management for admins utilizing DRF GenericViewSet."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
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
    pagination_class = StandardPagination
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
    pagination_class = StandardPagination
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
