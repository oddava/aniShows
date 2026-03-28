from django.contrib.auth import get_user_model
from django.db.models import Count
from django_filters import BooleanFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.viewsets import GenericViewSet, ViewSet

from apps.admin_api.services.user_admin_service import (
    AdminUserActionError,
    delete_user_account,
    toggle_user_active,
    toggle_user_staff,
)
from apps.admin_api.services.user_favorites_admin_service import (
    build_user_favorites_queryset,
    serialize_user_favorites,
)
from apps.admin_api.services.user_list_admin_service import (
    build_user_list_queryset,
    serialize_user_list_entries,
    serialize_user_list_entry,
)
from apps.animes.models import UserFavorite
from apps.core.permissions import IsAdminUser
from apps.users.admin_serializers import AdminUserSerializer
from apps.users.models import UserAnimeList

User = get_user_model()


class UserFilter(FilterSet):
    is_staff = BooleanFilter(field_name='is_staff')
    is_active = BooleanFilter(field_name='is_active')
    class Meta:
        model = User
        fields = ['is_staff', 'is_active']


class AdminUserViewSet(ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet):
    """User management for admins using robust DRF ViewSets."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminUserSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = UserFilter
    search_fields = ['username', 'email']
    ordering_fields = ['date_joined', 'username', 'email']
    ordering = ['-date_joined']

    def get_queryset(self):
        return (
            User.objects.select_related("userprofile")
            .annotate(
                _favorites_count=Count("favorites", distinct=True),
                _reviews_count=Count("reviews", distinct=True),
                _list_entries_count=Count("anime_lists", distinct=True),
            )
            .all()
        )

    @action(detail=True, methods=["post"])
    def toggle_active(self, request, pk=None):
        """Toggle user active status (ban/unban)."""
        user = self.get_object()

        try:
            result = toggle_user_active(user, request.user)
        except AdminUserActionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)

    @action(detail=True, methods=["post"])
    def toggle_staff(self, request, pk=None):
        """Toggle user staff/admin status."""
        user = self.get_object()

        try:
            result = toggle_user_staff(user, request.user)
        except AdminUserActionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)

    def destroy(self, request, *args, **kwargs):
        """Delete a user account."""
        user = self.get_object()
        try:
            result = delete_user_account(user, request.user)
        except AdminUserActionError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)

        return Response(result.payload, status=result.status_code)


class AdminUserListViewSet(ViewSet):
    """User list entries management for admins."""

    permission_classes = [IsAdminUser]
    def list(self, request):
        queryset = build_user_list_queryset(request.query_params)

        paginator_class = api_settings.DEFAULT_PAGINATION_CLASS
        if paginator_class is None:
            return Response(serialize_user_list_entries(queryset))

        paginator = paginator_class()
        page = paginator.paginate_queryset(queryset, request)

        entries_data = serialize_user_list_entries(page)

        return paginator.get_paginated_response(entries_data)

    def retrieve(self, request, pk=None):
        try:
            entry = UserAnimeList.objects.select_related("user", "anime").get(pk=pk)
        except UserAnimeList.DoesNotExist:
            return Response(
                {"detail": "List entry not found."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(serialize_user_list_entry(entry))

    def destroy(self, request, pk=None):
        try:
            entry = UserAnimeList.objects.get(pk=pk)
        except UserAnimeList.DoesNotExist:
            return Response(
                {"detail": "List entry not found."}, status=status.HTTP_404_NOT_FOUND
            )

        entry.delete()
        return Response({"message": "List entry deleted successfully."})

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        deleted_count, _ = UserAnimeList.objects.filter(id__in=ids).delete()
        return Response({"message": f"Deleted {deleted_count} list entries."})


class AdminFavoritesViewSet(ViewSet):
    """User favorites management for admins."""

    permission_classes = [IsAdminUser]
    def list(self, request):
        queryset = build_user_favorites_queryset(request.query_params)

        paginator_class = api_settings.DEFAULT_PAGINATION_CLASS
        if paginator_class is None:
            return Response(serialize_user_favorites(queryset))

        paginator = paginator_class()
        page = paginator.paginate_queryset(queryset, request)

        favorites_data = serialize_user_favorites(page)

        return paginator.get_paginated_response(favorites_data)

    def destroy(self, request, pk=None):
        try:
            fav = UserFavorite.objects.get(pk=pk)
        except UserFavorite.DoesNotExist:
            return Response({"detail": "Favorite not found."}, status=status.HTTP_404_NOT_FOUND)

        fav.delete()
        return Response({"message": "Favorite deleted successfully."})

    @action(detail=False, methods=["get"])
    def stats(self, request):
        base_qs = UserFavorite.objects.select_related("anime")
        top_anime = (
            base_qs.values(
                "anime_id",
                "anime__title",
                "anime__slug",
                "anime__cover_image",
                "anime__cover_image_external_url",
            )
            .annotate(favorite_count=Count("id"))
            .order_by("-favorite_count")[:6]
        )

        serialized_top = [
            {
                "id": item["anime_id"],
                "title": item["anime__title"],
                "slug": item["anime__slug"],
                "favorite_count": item["favorite_count"],
                "poster": item["anime__cover_image"] or item["anime__cover_image_external_url"] or "",
                "poster_small": item["anime__cover_image"] or item["anime__cover_image_external_url"] or "",
            }
            for item in top_anime
        ]

        return Response(
            {
                "total_favorites": base_qs.count(),
                "unique_users": base_qs.values("user_id").distinct().count(),
                "unique_anime": base_qs.values("anime_id").distinct().count(),
                "top_anime": serialized_top,
            }
        )
