from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django_filters import BooleanFilter, FilterSet
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ViewSet

from apps.animes.models import UserFavorite
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination
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
    pagination_class = StandardPagination
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

        # Prevent self-deactivation
        if user.id == request.user.id:
            return Response(
                {"detail": "Cannot deactivate your own account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Prevent modifying superusers (unless you're also superuser)
        if user.is_superuser and not request.user.is_superuser:
            return Response(
                {"detail": "Cannot modify superuser status."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user.is_active = not user.is_active
        user.save()

        return Response(
            {
                "id": user.id,
                "username": user.username,
                "is_active": user.is_active,
                "message": f"User {'activated' if user.is_active else 'deactivated'} successfully.",
            }
        )

    @action(detail=True, methods=["post"])
    def toggle_staff(self, request, pk=None):
        """Toggle user staff/admin status."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can modify staff status."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object()

        # Prevent self-modification
        if user.id == request.user.id:
            return Response(
                {"detail": "Cannot modify your own staff status."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.is_staff = not user.is_staff
        user.save()

        return Response(
            {
                "id": user.id,
                "username": user.username,
                "is_staff": user.is_staff,
                "message": f"User {'promoted to' if user.is_staff else 'removed from'} staff.",
            }
        )

    def destroy(self, request, *args, **kwargs):
        """Delete a user account."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete users."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object()

        # Prevent self-deletion
        if user.id == request.user.id:
            return Response(
                {"detail": "Cannot delete your own account through admin."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Prevent deleting other superusers
        if user.is_superuser:
            return Response(
                {"detail": "Cannot delete superuser accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        username = user.username
        self.perform_destroy(user)

        return Response({"message": f"User '{username}' deleted successfully."})


class AdminUserListViewSet(ViewSet):
    """User list entries management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination

    def list(self, request):
        queryset = UserAnimeList.objects.select_related("user", "anime")

        # Filters
        list_status = request.query_params.get("status")
        if list_status:
            queryset = queryset.filter(status=list_status)

        min_score = request.query_params.get("min_score")
        if min_score:
            queryset = queryset.filter(score__gte=int(min_score))

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(
                Q(user__username__icontains=search) | Q(anime__title__icontains=search)
            )

        # Sorting
        ordering = request.query_params.get("ordering", "-updated_at")
        valid_orderings = ["updated_at", "-updated_at", "score", "-score"]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, request)

        entries_data = [
            {
                "id": entry.id,
                "user": {"id": entry.user.id, "username": entry.user.username},
                "anime": {"id": entry.anime.id, "title": entry.anime.title},
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "updated_at": entry.updated_at.isoformat(),
            }
            for entry in page
        ]

        return paginator.get_paginated_response(entries_data)

    def retrieve(self, request, pk=None):
        try:
            entry = UserAnimeList.objects.select_related("user", "anime").get(pk=pk)
        except UserAnimeList.DoesNotExist:
            return Response(
                {"detail": "List entry not found."}, status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {
                "id": entry.id,
                "user": {"id": entry.user.id, "username": entry.user.username},
                "anime": {"id": entry.anime.id, "title": entry.anime.title},
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "is_rewatching": entry.is_rewatching,
                "notes": entry.notes,
                "started_at": entry.started_at.isoformat() if entry.started_at else None,
                "finished_at": entry.finished_at.isoformat() if entry.finished_at else None,
                "updated_at": entry.updated_at.isoformat(),
            }
        )

    def destroy(self, request, pk=None):
        try:
            entry = UserAnimeList.objects.get(pk=pk)
        except UserAnimeList.DoesNotExist:
            return Response(
                {"detail": "List entry not found."}, status=status.HTTP_404_NOT_FOUND
            )

        entry.delete()
        return Response({"message": "List entry deleted successfully."})


class AdminFavoritesViewSet(ViewSet):
    """User favorites management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination

    def list(self, request):
        queryset = UserFavorite.objects.select_related("user", "anime")

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(
                Q(user__username__icontains=search) | Q(anime__title__icontains=search)
            )

        # Sorting
        ordering = request.query_params.get("ordering", "-created_at")
        valid_orderings = ["created_at", "-created_at"]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, request)

        favorites_data = [
            {
                "id": fav.id,
                "user": {"id": fav.user.id, "username": fav.user.username},
                "anime": {"id": fav.anime.id, "title": fav.anime.title},
                "created_at": fav.created_at.isoformat(),
            }
            for fav in page
        ]

        return paginator.get_paginated_response(favorites_data)

    def destroy(self, request, pk=None):
        try:
            fav = UserFavorite.objects.get(pk=pk)
        except UserFavorite.DoesNotExist:
            return Response({"detail": "Favorite not found."}, status=status.HTTP_404_NOT_FOUND)

        fav.delete()
        return Response({"message": "Favorite deleted successfully."})
