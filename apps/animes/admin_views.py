"""Admin API Views for aniShows Dashboard.

Provides secure admin-only endpoints for:
- Dashboard statistics
- User management
- Anime management
- Review moderation
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Avg, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from datetime import timedelta, datetime

from rest_framework import status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin, DestroyModelMixin
from django_filters.rest_framework import DjangoFilterBackend
from django_filters import FilterSet, BooleanFilter, CharFilter, NumberFilter
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ViewSet

from apps.animes.models import Anime, Genre, Studio, UserFavorite, UserHistory, Review
from apps.users.models import UserProfile, UserAnimeList
from apps.core.models import SystemLog, AuditLog
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination

# Serializers
from apps.users.admin_serializers import AdminUserSerializer
from apps.animes.admin_serializers import (
    AdminAnimeSerializer,
    AdminGenreSerializer,
    AdminStudioSerializer,
    AdminReviewSerializer
)

User = get_user_model()


class AdminDashboardView(APIView):
    """Dashboard statistics and overview data."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        now = timezone.now()
        last_7_days = now - timedelta(days=7)
        last_30_days = now - timedelta(days=30)

        # User statistics
        total_users = User.objects.count()
        new_users_7d = User.objects.filter(date_joined__gte=last_7_days).count()
        new_users_30d = User.objects.filter(date_joined__gte=last_30_days).count()
        verified_users = UserProfile.objects.filter(email_verified=True).count()

        # Content statistics
        total_anime = Anime.objects.count()
        airing_anime = Anime.objects.filter(status="Airing").count()
        total_reviews = Review.objects.count()
        new_reviews_7d = Review.objects.filter(created_at__gte=last_7_days).count()

        # Engagement statistics
        total_favorites = UserFavorite.objects.count()
        total_list_entries = UserAnimeList.objects.count()

        # User growth (last 30 days)
        user_growth = (
            User.objects.filter(date_joined__gte=last_30_days)
            .annotate(date=TruncDate("date_joined"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )

        # Popular anime (most favorites)
        popular_anime = (
            Anime.objects.annotate(favorite_count=Count("favorites"))
            .order_by("-favorite_count")[:5]
            .values("id", "title", "slug", "cover_image", "favorite_count")
        )

        # Recent reviews
        recent_reviews = Review.objects.select_related("user", "anime").order_by("-created_at")[:5]

        recent_reviews_data = [
            {
                "id": r.id,
                "user": r.user.username,
                "anime": r.anime.title,
                "anime_slug": r.anime.slug,
                "rating": r.rating,
                "has_spoilers": r.has_spoilers,
                "created_at": r.created_at.isoformat(),
            }
            for r in recent_reviews
        ]

        # Recent users
        recent_users = User.objects.order_by("-date_joined")[:5].values(
            "id", "username", "email", "date_joined", "is_active", "is_staff"
        )

        return Response(
            {
                "statistics": {
                    "users": {
                        "total": total_users,
                        "new_7d": new_users_7d,
                        "new_30d": new_users_30d,
                        "verified": verified_users,
                    },
                    "content": {
                        "total_anime": total_anime,
                        "airing_anime": airing_anime,
                        "total_reviews": total_reviews,
                        "new_reviews_7d": new_reviews_7d,
                    },
                    "engagement": {
                        "total_favorites": total_favorites,
                        "total_list_entries": total_list_entries,
                    },
                },
                "charts": {
                    "user_growth": list(user_growth),
                },
                "popular_anime": list(popular_anime),
                "recent_reviews": recent_reviews_data,
                "recent_users": list(recent_users),
            }
        )


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


class ReviewFilter(FilterSet):
    has_spoilers = BooleanFilter(field_name='has_spoilers')
    min_rating = NumberFilter(field_name='rating', lookup_expr='gte')
    max_rating = NumberFilter(field_name='rating', lookup_expr='lte')
    class Meta:
        model = Review
        fields = ['has_spoilers']

class AdminReviewViewSet(ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet):
    """Review moderation for admins via DRF ModelViewset principles."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    serializer_class = AdminReviewSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ReviewFilter
    search_fields = ['text', 'user__username', 'anime__title']
    ordering_fields = ['created_at', 'rating']
    ordering = ['-created_at']

    def get_queryset(self):
        return Review.objects.select_related("user", "anime")


class AdminStatsExportView(APIView):
    """Export statistics data for admins."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        """Export summary statistics as JSON."""
        now = timezone.now()

        # Gather comprehensive stats
        stats = {
            "generated_at": now.isoformat(),
            "users": {
                "total": User.objects.count(),
                "active": User.objects.filter(is_active=True).count(),
                "staff": User.objects.filter(is_staff=True).count(),
                "superusers": User.objects.filter(is_superuser=True).count(),
            },
            "content": {
                "anime": {
                    "total": Anime.objects.count(),
                    "by_status": dict(
                        Anime.objects.values_list("status").annotate(count=Count("id"))
                    ),
                    "by_type": dict(
                        Anime.objects.values_list("anime_type").annotate(count=Count("id"))
                    ),
                },
                "genres": Genre.objects.count(),
                "studios": Studio.objects.count(),
            },
            "engagement": {
                "reviews": Review.objects.count(),
                "favorites": UserFavorite.objects.count(),
                "list_entries": UserAnimeList.objects.count(),
                "history_entries": UserHistory.objects.count(),
            },
        }

        return Response(stats)


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


class AdminBulkOperationsView(APIView):
    """Bulk operations for admins."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        action = request.data.get("action")
        entity = request.data.get("entity")
        ids = request.data.get("ids", [])

        if not action or not entity or not ids:
            return Response(
                {"detail": "Action, entity, and a list of IDs are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(ids, list):
            return Response(
                {"detail": "IDs must be provided as a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Define allowed bulk operations
        allowed_operations = {
            "anime": {
                "update_status": self._bulk_update_anime_status,
                "delete": self._bulk_delete_entities,
            },
            "reviews": {
                "delete": self._bulk_delete_entities,
                "toggle_spoilers": self._bulk_toggle_review_spoilers,
            },
            "users": {
                "toggle_active": self._bulk_toggle_user_active,
            },
        }

        if entity not in allowed_operations:
            return Response(
                {"detail": f"Invalid entity. Allowed endpoints: {', '.join(allowed_operations.keys())}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if action not in allowed_operations[entity]:
            return Response(
                {
                    "detail": f"Invalid action for entity {entity}. Allowed: {', '.join(allowed_operations[entity].keys())}"
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Execute operations
        try:
            handler = allowed_operations[entity][action]
            result = handler(request, entity, ids)
            return Response({"message": "Bulk operation completed.", "result": result})
        except Exception as e:
            return Response(
                {"detail": f"An error occurred during bulk operation: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def _bulk_update_anime_status(self, request, entity, ids):
        new_status = request.data.get("status")
        if not new_status:
            raise ValueError("Status is required for bulk status update.")

        updated_count = Anime.objects.filter(id__in=ids).update(status=new_status)
        return {"updated_count": updated_count, "new_status": new_status}

    def _bulk_delete_entities(self, request, entity, ids):
        if not request.user.is_superuser:
            raise ValueError("Only superusers can perform bulk delete actions.")

        model_map = {"anime": Anime, "reviews": Review}
        model = model_map[entity]

        deleted_count = model.objects.filter(id__in=ids).delete()[0]
        return {"deleted_count": deleted_count}

    def _bulk_toggle_review_spoilers(self, request, entity, ids):
        reviews = Review.objects.filter(id__in=ids)
        updated_count = 0
        for review in reviews:
            review.has_spoilers = not review.has_spoilers
            review.save(update_fields=["has_spoilers"])
            updated_count += 1

        return {"updated_count": updated_count}

    def _bulk_toggle_user_active(self, request, entity, ids):
        if not request.user.is_superuser:
            raise ValueError("Only superusers can toggle user status.")

        # Exclude current user and superusers
        users = User.objects.filter(id__in=ids).exclude(id=request.user.id)
        if not request.user.is_superuser:
            users = users.exclude(is_superuser=True)

        updated_count = 0
        for user in users:
            user.is_active = not user.is_active
            user.save(update_fields=["is_active"])
            updated_count += 1

        return {"updated_count": updated_count}


class AdminReportsView(APIView):
    """Generate various admin reports."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        report_type = request.query_params.get("type")

        if not report_type:
            return Response(
                {"detail": "Report type is required. (e.g., 'user_activity', 'anime_popularity')"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if report_type == "user_activity":
            return self._generate_user_activity_report()
        elif report_type == "anime_popularity":
            return self._generate_anime_popularity_report()
        else:
            return Response(
                {"detail": "Invalid report type."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _generate_user_activity_report(self):
        # Activity over the last 30 days
        now = timezone.now()
        last_30_days = now - timedelta(days=30)

        # Registrations by day
        registrations = (
            User.objects.filter(date_joined__gte=last_30_days)
            .annotate(date=TruncDate("date_joined"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )

        # Reviews by day
        reviews = (
            Review.objects.filter(created_at__gte=last_30_days)
            .annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )

        return Response(
            {
                "report": "user_activity",
                "period": "30_days",
                "data": {
                    "registrations": list(registrations),
                    "reviews": list(reviews),
                },
            }
        )

    def _generate_anime_popularity_report(self):
        # Top anime by favorites
        top_favorites = (
            Anime.objects.annotate(count=Count("favorites"))
            .order_by("-count")[:10]
            .values("id", "title", "count")
        )

        # Top anime by lists (all statuses)
        top_lists = (
            Anime.objects.annotate(count=Count("user_lists"))
            .order_by("-count")[:10]
            .values("id", "title", "count")
        )

        # Top anime by rating (min 5 reviews)
        top_rated = (
            Anime.objects.annotate(
                review_count=Count("reviews"), avg_rating=Avg("reviews__rating")
            )
            .filter(review_count__gte=5)
            .order_by("-avg_rating")[:10]
            .values("id", "title", "avg_rating", "review_count")
        )

        return Response(
            {
                "report": "anime_popularity",
                "data": {
                    "top_by_favorites": list(top_favorites),
                    "top_by_lists": list(top_lists),
                    "top_by_rating": list(top_rated),
                },
            }
        )


class SystemLogFilter(FilterSet):
    level = CharFilter(field_name='level')
    log_type = CharFilter(field_name='log_type')
    status_code = NumberFilter(field_name='status_code')
    class Meta:
        model = SystemLog
        fields = ['level', 'log_type', 'status_code']

class AdminSystemLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """System logs management for admins. ReadOnly plus custom Actions."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = SystemLogFilter
    search_fields = ['message', 'details', 'path']
    ordering_fields = ['timestamp', 'level']
    ordering = ['-timestamp']

    def get_queryset(self):
        return SystemLog.objects.select_related("user").all()

    def list(self, request, *args, **kwargs):
        """Extended list using the generic features without a dedicated serializer class."""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        
        logs_data = []
        for log in page:
            logs_data.append(
                {
                    "id": log.id,
                    "timestamp": log.timestamp.isoformat(),
                    "level": log.level,
                    "log_type": log.log_type,
                    "user": {
                        "id": log.user.id,
                        "username": log.user.username,
                    }
                    if log.user else None,
                    "user_ip": log.user_ip,
                    "method": log.method,
                    "path": log.path,
                    "status_code": log.status_code,
                    "message": log.message,
                    "details": log.details,
                    "duration_ms": log.duration_ms,
                }
            )
        return self.get_paginated_response(logs_data)

    def retrieve(self, request, *args, **kwargs):
        log = self.get_object()
        return Response(
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat(),
                "level": log.level,
                "log_type": log.log_type,
                "user": {
                    "id": log.user.id,
                    "username": log.user.username,
                }
                if log.user else None,
                "user_ip": log.user_ip,
                "method": log.method,
                "path": log.path,
                "status_code": log.status_code,
                "message": log.message,
                "details": log.details,
                "duration_ms": log.duration_ms,
            }
        )

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get system log statistics."""
        # Total counts
        total = SystemLog.objects.count()

        # Count by level
        by_level = dict(SystemLog.objects.values_list("level").annotate(count=Count("id")))

        # Count by type
        by_type = dict(SystemLog.objects.values_list("log_type").annotate(count=Count("id")))

        # Recent counts (last 24 hours, 7 days, 30 days)
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)
        last_30d = now - timedelta(days=30)

        recent_counts = {
            "last_24h": SystemLog.objects.filter(timestamp__gte=last_24h).count(),
            "last_7d": SystemLog.objects.filter(timestamp__gte=last_7d).count(),
            "last_30d": SystemLog.objects.filter(timestamp__gte=last_30d).count(),
        }

        # Error rate (last 24 hours)
        error_count = SystemLog.objects.filter(
            timestamp__gte=last_24h, level__in=["ERROR", "CRITICAL"]
        ).count()
        total_24h = SystemLog.objects.filter(timestamp__gte=last_24h).count()
        error_rate = round((error_count / total_24h * 100), 2) if total_24h > 0 else 0

        return Response(
            {
                "total": total,
                "by_level": by_level,
                "by_type": by_type,
                "recent_counts": recent_counts,
                "error_rate_24h": error_rate,
            }
        )

    @action(detail=False, methods=["post"])
    def clear_old(self, request):
        """Clear old system logs."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can clear logs."},
                status=status.HTTP_403_FORBIDDEN,
            )

        days = int(request.data.get("days", 90))
        cutoff_date = timezone.now() - timedelta(days=days)

        # Filter by level if specified
        levels = request.data.get("levels", [])
        queryset = SystemLog.objects.filter(timestamp__lt=cutoff_date)

        if levels:
            queryset = queryset.filter(level__in=levels)

        deleted_count = queryset.delete()[0]

        return Response(
            {
                "message": f"{deleted_count} system log entries deleted.",
                "cutoff_date": cutoff_date.isoformat(),
                "levels": levels if levels else "all",
            }
        )


class AuditLogFilter(FilterSet):
    action = CharFilter(field_name='action')
    entity_type = CharFilter(field_name='entity_type', lookup_expr='iexact')
    class Meta:
        model = AuditLog
        fields = ['action', 'entity_type']

class AdminAuditLogViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Audit logs management for admins. ReadOnly plus Custom Actions."""

    permission_classes = [IsAdminUser]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = AuditLogFilter
    search_fields = ['entity_repr', 'entity_type', 'user__username']
    ordering_fields = ['timestamp', 'action']
    ordering = ['-timestamp']

    def get_queryset(self):
        # We manually process dating querying due to date strings since generic filtersets don't capture custom date parsing safely without explicit classes
        queryset = AuditLog.objects.select_related("user").all()

        start_date = self.request.query_params.get("start_date")
        if start_date:
            try:
                start = datetime.strptime(start_date, "%Y-%m-%d")
                queryset = queryset.filter(timestamp__gte=start)
            except ValueError:
                pass

        end_date = self.request.query_params.get("end_date")
        if end_date:
            try:
                end = datetime.strptime(end_date, "%Y-%m-%d")
                end = end.replace(hour=23, minute=59, second=59)
                queryset = queryset.filter(timestamp__lte=end)
            except ValueError:
                pass
                
        return queryset

    def list(self, request, *args, **kwargs):
        """Extended generic list view without serializing classes manually"""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        
        logs_data = []
        for log in page:
            logs_data.append(
                {
                    "id": log.id,
                    "timestamp": log.timestamp.isoformat(),
                    "user": {
                        "id": log.user.id,
                        "username": log.user.username,
                    }
                    if log.user else None,
                    "user_ip": log.user_ip,
                    "action": log.action,
                    "entity_type": log.entity_type,
                    "entity_id": log.entity_id,
                    "entity_repr": log.entity_repr,
                    "changes": log.changes,
                    "metadata": log.metadata,
                }
            )

        return self.get_paginated_response(logs_data)

    def retrieve(self, request, *args, **kwargs):
        log = self.get_object()
        return Response(
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat(),
                "user": {
                    "id": log.user.id,
                    "username": log.user.username,
                }
                if log.user else None,
                "user_ip": log.user_ip,
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "entity_repr": log.entity_repr,
                "previous_state": log.previous_state,
                "new_state": log.new_state,
                "changes": log.changes,
                "metadata": log.metadata,
            }
        )

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get audit log statistics."""

        # Total counts
        total = AuditLog.objects.count()

        # Count by action
        by_action = dict(AuditLog.objects.values_list("action").annotate(count=Count("id")))

        # Count by entity type
        by_entity_type = dict(
            AuditLog.objects.values_list("entity_type")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        # Recent counts (last 24 hours, 7 days, 30 days)
        now = timezone.now()
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)
        last_30d = now - timedelta(days=30)

        recent_counts = {
            "last_24h": AuditLog.objects.filter(timestamp__gte=last_24h).count(),
            "last_7d": AuditLog.objects.filter(timestamp__gte=last_7d).count(),
            "last_30d": AuditLog.objects.filter(timestamp__gte=last_30d).count(),
        }

        # Most active users (by audit actions)
        most_active_users = (
            AuditLog.objects.filter(user__isnull=False)
            .values("user__id", "user__username")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        return Response(
            {
                "total": total,
                "by_action": by_action,
                "by_entity_type": by_entity_type,
                "recent_counts": recent_counts,
                "most_active_users": list(most_active_users),
            }
        )

    @action(detail=False, methods=["post"])
    def clear_old(self, request):
        """Clear old audit logs."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can clear audit logs."},
                status=status.HTTP_403_FORBIDDEN,
            )

        days = int(request.data.get("days", 180))
        cutoff_date = timezone.now() - timedelta(days=days)

        # Filter by action if specified
        actions = request.data.get("actions", [])
        queryset = AuditLog.objects.filter(timestamp__lt=cutoff_date)

        if actions:
            queryset = queryset.filter(action__in=actions)

        deleted_count = queryset.delete()[0]

        return Response(
            {
                "message": f"{deleted_count} audit log entries deleted.",
                "cutoff_date": cutoff_date.isoformat(),
                "actions": actions if actions else "all",
            }
        )
