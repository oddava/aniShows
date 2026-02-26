"""
Admin API Views for aniShows Dashboard

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
from datetime import timedelta

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.animes.models import Anime, Genre, Studio, UserFavorite, UserHistory, Review
from apps.users.models import UserProfile, UserAnimeList
from apps.core.models import SystemLog, AuditLog
from apps.core.permissions import IsAdminUser, AdminPagination
from datetime import datetime

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


class AdminUserViewSet(viewsets.ViewSet):
    """User management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all users with filtering and search - optimized with annotations."""
        from django.db.models import Count

        # Annotate with counts to avoid N+1 queries
        queryset = (
            User.objects.select_related("userprofile")
            .annotate(
                _favorites_count=Count("favorites", distinct=True),
                _reviews_count=Count("reviews", distinct=True),
                _list_entries_count=Count("anime_lists", distinct=True),
            )
            .all()
        )

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(Q(username__icontains=search) | Q(email__icontains=search))

        # Filters
        is_staff = request.query_params.get("is_staff")
        if is_staff is not None:
            queryset = queryset.filter(is_staff=is_staff.lower() == "true")

        is_active = request.query_params.get("is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == "true")

        # Sorting
        ordering = request.query_params.get("ordering", "-date_joined")
        valid_orderings = [
            "date_joined",
            "-date_joined",
            "username",
            "-username",
            "email",
            "-email",
        ]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        users_data = []
        for user in page:
            profile = getattr(user, "userprofile", None)
            users_data.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "date_joined": user.date_joined.isoformat(),
                    "last_login": user.last_login.isoformat() if user.last_login else None,
                    "is_active": user.is_active,
                    "is_staff": user.is_staff,
                    "is_superuser": user.is_superuser,
                    "email_verified": profile.email_verified if profile else False,
                    "avatar": profile.avatar.url if profile and profile.avatar else None,
                }
            )

        return paginator.get_paginated_response(users_data)

    def retrieve(self, request, pk=None):
        """Get detailed user information - optimized with annotations."""
        from django.db.models import Count

        try:
            user = (
                User.objects.select_related("userprofile")
                .annotate(
                    _favorites_count=Count("favorites", distinct=True),
                    _reviews_count=Count("reviews", distinct=True),
                    _list_entries_count=Count("anime_lists", distinct=True),
                )
                .get(pk=pk)
            )
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        profile = getattr(user, "userprofile", None)

        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "date_joined": user.date_joined.isoformat(),
                "last_login": user.last_login.isoformat() if user.last_login else None,
                "is_active": user.is_active,
                "is_staff": user.is_staff,
                "is_superuser": user.is_superuser,
                "email_verified": profile.email_verified if profile else False,
                "avatar": profile.avatar.url if profile and profile.avatar else None,
                "banner": profile.banner.url if profile and profile.banner else None,
                "bio": profile.bio if profile else None,
                "is_private": profile.is_private if profile else False,
                "activity": {
                    "favorites_count": user._favorites_count,
                    "reviews_count": user._reviews_count,
                    "list_entries_count": user._list_entries_count,
                },
            }
        )

    @action(detail=True, methods=["post"])
    def toggle_active(self, request, pk=None):
        """Toggle user active status (ban/unban)."""
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

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

        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

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

    def destroy(self, request, pk=None):
        """Delete a user account."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete users."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

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
        user.delete()

        return Response({"message": f"User '{username}' deleted successfully."})


class AdminAnimeViewSet(viewsets.ViewSet):
    """Anime management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all anime with filtering."""
        queryset = Anime.objects.prefetch_related("genres").select_related("studio")

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(title_jp__icontains=search))

        # Filters
        anime_status = request.query_params.get("status")
        if anime_status:
            queryset = queryset.filter(status=anime_status)

        anime_type = request.query_params.get("type")
        if anime_type:
            queryset = queryset.filter(anime_type=anime_type)

        # Sorting
        ordering = request.query_params.get("ordering", "-created_at")
        valid_orderings = [
            "title",
            "-title",
            "created_at",
            "-created_at",
            "rating",
            "-rating",
            "release_date",
            "-release_date",
        ]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Annotate with stats
        queryset = queryset.annotate(
            favorites_count=Count("favorites"), reviews_count=Count("reviews")
        )

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        anime_data = []
        for anime in page:
            anime_data.append(
                {
                    "id": anime.id,
                    "title": anime.title,
                    "title_jp": anime.title_jp,
                    "slug": anime.slug,
                    "status": anime.status,
                    "anime_type": anime.anime_type,
                    "rating": float(anime.rating) if anime.rating else None,
                    "episode_count": anime.episode_count,
                    "release_date": anime.release_date.isoformat() if anime.release_date else None,
                    "cover_image": anime.cover_image.url if anime.cover_image else None,
                    "studio": anime.studio.name if anime.studio else None,
                    "genres": [g.name for g in anime.genres.all()],
                    "favorites_count": anime.favorites_count,
                    "reviews_count": anime.reviews_count,
                    "created_at": anime.created_at.isoformat(),
                }
            )

        return paginator.get_paginated_response(anime_data)

    def retrieve(self, request, pk=None):
        """Get detailed anime information."""
        try:
            anime = Anime.objects.prefetch_related("genres").select_related("studio").get(pk=pk)
        except Anime.DoesNotExist:
            return Response({"detail": "Anime not found."}, status=status.HTTP_404_NOT_FOUND)

        favorites_count = anime.favorites.count()
        reviews_count = anime.reviews.count()
        avg_rating = anime.reviews.aggregate(avg=Avg("rating"))["avg"]

        return Response(
            {
                "id": anime.id,
                "title": anime.title,
                "title_jp": anime.title_jp,
                "slug": anime.slug,
                "synopsis": anime.synopsis,
                "status": anime.status,
                "anime_type": anime.anime_type,
                "rating": float(anime.rating) if anime.rating else None,
                "episode_count": anime.episode_count,
                "duration_minutes": anime.duration_minutes,
                "release_date": anime.release_date.isoformat() if anime.release_date else None,
                "end_date": anime.end_date.isoformat() if anime.end_date else None,
                "cover_image": anime.cover_image.url if anime.cover_image else None,
                "banner_image": anime.banner_image.url if anime.banner_image else None,
                "trailer_url": anime.trailer_url,
                "studio": {"id": anime.studio.id, "name": anime.studio.name}
                if anime.studio
                else None,
                "genres": [{"id": g.id, "name": g.name} for g in anime.genres.all()],
                "meta_description": anime.meta_description,
                "favorites_count": favorites_count,
                "reviews_count": reviews_count,
                "avg_review_rating": float(avg_rating) if avg_rating else None,
                "created_at": anime.created_at.isoformat(),
                "updated_at": anime.updated_at.isoformat(),
            }
        )

    def destroy(self, request, pk=None):
        """Delete an anime."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can delete anime."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            anime = Anime.objects.get(pk=pk)
        except Anime.DoesNotExist:
            return Response({"detail": "Anime not found."}, status=status.HTTP_404_NOT_FOUND)

        title = anime.title
        anime.delete()

        return Response({"message": f"Anime '{title}' deleted successfully."})


class AdminReviewViewSet(viewsets.ViewSet):
    """Review moderation for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all reviews with filtering."""
        queryset = Review.objects.select_related("user", "anime")

        # Filters
        has_spoilers = request.query_params.get("has_spoilers")
        if has_spoilers is not None:
            queryset = queryset.filter(has_spoilers=has_spoilers.lower() == "true")

        min_rating = request.query_params.get("min_rating")
        if min_rating:
            queryset = queryset.filter(rating__gte=int(min_rating))

        max_rating = request.query_params.get("max_rating")
        if max_rating:
            queryset = queryset.filter(rating__lte=int(max_rating))

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(
                Q(text__icontains=search)
                | Q(user__username__icontains=search)
                | Q(anime__title__icontains=search)
            )

        # Sorting
        ordering = request.query_params.get("ordering", "-created_at")
        valid_orderings = ["created_at", "-created_at", "rating", "-rating"]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        reviews_data = []
        for review in page:
            reviews_data.append(
                {
                    "id": review.id,
                    "user": {
                        "id": review.user.id,
                        "username": review.user.username,
                    },
                    "anime": {
                        "id": review.anime.id,
                        "title": review.anime.title,
                        "slug": review.anime.slug,
                    },
                    "rating": review.rating,
                    "text": review.text[:200] + "..." if len(review.text) > 200 else review.text,
                    "has_spoilers": review.has_spoilers,
                    "created_at": review.created_at.isoformat(),
                }
            )

        return paginator.get_paginated_response(reviews_data)

    def retrieve(self, request, pk=None):
        """Get full review details."""
        try:
            review = Review.objects.select_related("user", "anime").get(pk=pk)
        except Review.DoesNotExist:
            return Response({"detail": "Review not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "id": review.id,
                "user": {
                    "id": review.user.id,
                    "username": review.user.username,
                },
                "anime": {
                    "id": review.anime.id,
                    "title": review.anime.title,
                    "slug": review.anime.slug,
                },
                "rating": review.rating,
                "text": review.text,
                "has_spoilers": review.has_spoilers,
                "created_at": review.created_at.isoformat(),
                "updated_at": review.updated_at.isoformat(),
            }
        )

    def destroy(self, request, pk=None):
        """Delete a review."""
        try:
            review = Review.objects.get(pk=pk)
        except Review.DoesNotExist:
            return Response({"detail": "Review not found."}, status=status.HTTP_404_NOT_FOUND)

        review.delete()

        return Response({"message": "Review deleted successfully."})


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


class AdminGenreViewSet(viewsets.ViewSet):
    """Genre management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all genres with anime count."""
        queryset = Genre.objects.annotate(anime_count=Count("anime")).order_by("name")

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(name__icontains=search)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        genres_data = [
            {
                "id": g.id,
                "name": g.name,
                "slug": g.slug,
                "description": g.description,
                "anime_count": g.anime_count,
            }
            for g in page
        ]

        return paginator.get_paginated_response(genres_data)

    def create(self, request):
        """Create a new genre."""
        name = request.data.get("name")
        slug = request.data.get("slug")
        description = request.data.get("description", "")

        if not name:
            return Response({"detail": "Name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if Genre.objects.filter(name__iexact=name).exists():
            return Response(
                {"detail": "Genre with this name already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        genre = Genre.objects.create(
            name=name,
            slug=slug or name.lower().replace(" ", "-"),
            description=description,
        )

        return Response(
            {
                "id": genre.id,
                "name": genre.name,
                "slug": genre.slug,
                "description": genre.description,
                "message": "Genre created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        """Get genre details."""
        try:
            genre = Genre.objects.annotate(anime_count=Count("anime")).get(pk=pk)
        except Genre.DoesNotExist:
            return Response({"detail": "Genre not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "id": genre.id,
                "name": genre.name,
                "slug": genre.slug,
                "description": genre.description,
                "anime_count": genre.anime_count,
            }
        )

    def update(self, request, pk=None):
        """Update a genre."""
        try:
            genre = Genre.objects.get(pk=pk)
        except Genre.DoesNotExist:
            return Response({"detail": "Genre not found."}, status=status.HTTP_404_NOT_FOUND)

        genre.name = request.data.get("name", genre.name)
        genre.slug = request.data.get("slug", genre.slug)
        genre.description = request.data.get("description", genre.description)
        genre.save()

        return Response(
            {
                "id": genre.id,
                "name": genre.name,
                "slug": genre.slug,
                "description": genre.description,
                "message": "Genre updated successfully.",
            }
        )

    def destroy(self, request, pk=None):
        """Delete a genre."""
        try:
            genre = Genre.objects.annotate(anime_count=Count("anime")).get(pk=pk)
        except Genre.DoesNotExist:
            return Response({"detail": "Genre not found."}, status=status.HTTP_404_NOT_FOUND)

        if genre.anime_count > 0 and not request.query_params.get("force"):
            return Response(
                {
                    "detail": f"Cannot delete genre with {genre.anime_count} associated anime. Use ?force=true to delete anyway.",
                    "anime_count": genre.anime_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = genre.name
        genre.delete()

        return Response({"message": f"Genre '{name}' deleted successfully."})


class AdminStudioViewSet(viewsets.ViewSet):
    """Studio management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all studios with anime count."""
        queryset = Studio.objects.annotate(anime_count=Count("anime")).order_by("name")

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(name__icontains=search)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        studios_data = [
            {
                "id": s.id,
                "name": s.name,
                "founded_date": s.founded_date.isoformat() if s.founded_date else None,
                "website": s.website,
                "anime_count": s.anime_count,
            }
            for s in page
        ]

        return paginator.get_paginated_response(studios_data)

    def create(self, request):
        """Create a new studio."""
        name = request.data.get("name")
        founded_date = request.data.get("founded_date")
        website = request.data.get("website", "")

        if not name:
            return Response({"detail": "Name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if Studio.objects.filter(name__iexact=name).exists():
            return Response(
                {"detail": "Studio with this name already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        studio = Studio.objects.create(
            name=name, founded_date=founded_date or None, website=website
        )

        return Response(
            {
                "id": studio.id,
                "name": studio.name,
                "founded_date": studio.founded_date.isoformat() if studio.founded_date else None,
                "website": studio.website,
                "message": "Studio created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        """Get studio details with anime list."""
        try:
            studio = Studio.objects.annotate(anime_count=Count("anime")).get(pk=pk)
        except Studio.DoesNotExist:
            return Response({"detail": "Studio not found."}, status=status.HTTP_404_NOT_FOUND)

        # Get recent anime by this studio
        recent_anime = studio.anime_set.order_by("-release_date")[:10].values(
            "id", "title", "slug", "cover_image", "rating", "status"
        )

        return Response(
            {
                "id": studio.id,
                "name": studio.name,
                "founded_date": studio.founded_date.isoformat() if studio.founded_date else None,
                "website": studio.website,
                "anime_count": studio.anime_count,
                "recent_anime": list(recent_anime),
            }
        )

    def update(self, request, pk=None):
        """Update a studio."""
        try:
            studio = Studio.objects.get(pk=pk)
        except Studio.DoesNotExist:
            return Response({"detail": "Studio not found."}, status=status.HTTP_404_NOT_FOUND)

        studio.name = request.data.get("name", studio.name)
        studio.founded_date = request.data.get("founded_date", studio.founded_date)
        studio.website = request.data.get("website", studio.website)
        studio.save()

        return Response(
            {
                "id": studio.id,
                "name": studio.name,
                "founded_date": studio.founded_date.isoformat() if studio.founded_date else None,
                "website": studio.website,
                "message": "Studio updated successfully.",
            }
        )

    def destroy(self, request, pk=None):
        """Delete a studio."""
        try:
            studio = Studio.objects.annotate(anime_count=Count("anime")).get(pk=pk)
        except Studio.DoesNotExist:
            return Response({"detail": "Studio not found."}, status=status.HTTP_404_NOT_FOUND)

        if studio.anime_count > 0 and not request.query_params.get("force"):
            return Response(
                {
                    "detail": f"Cannot delete studio with {studio.anime_count} associated anime. Use ?force=true to delete anyway.",
                    "anime_count": studio.anime_count,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = studio.name
        studio.delete()

        return Response({"message": f"Studio '{name}' deleted successfully."})


class AdminUserListViewSet(viewsets.ViewSet):
    """User list entries management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all user list entries."""
        queryset = UserAnimeList.objects.select_related("user", "anime").order_by("-updated_at")

        # Filters
        user_id = request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        anime_id = request.query_params.get("anime")
        if anime_id:
            queryset = queryset.filter(anime_id=anime_id)

        list_status = request.query_params.get("status")
        if list_status:
            queryset = queryset.filter(status=list_status)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        entries_data = [
            {
                "id": entry.id,
                "user": {
                    "id": entry.user.id,
                    "username": entry.user.username,
                },
                "anime": {
                    "id": entry.anime.id,
                    "title": entry.anime.title,
                    "slug": entry.anime.slug,
                },
                "status": entry.status,
                "score": entry.score,
                "episodes_watched": entry.episodes_watched,
                "updated_at": entry.updated_at.isoformat(),
            }
            for entry in page
        ]

        return paginator.get_paginated_response(entries_data)

    def destroy(self, request, pk=None):
        """Delete a list entry."""
        try:
            entry = UserAnimeList.objects.get(pk=pk)
        except UserAnimeList.DoesNotExist:
            return Response({"detail": "List entry not found."}, status=status.HTTP_404_NOT_FOUND)

        entry.delete()

        return Response({"message": "List entry deleted successfully."})

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        """Bulk delete list entries."""
        ids = request.data.get("ids", [])
        if not ids:
            return Response({"detail": "No IDs provided."}, status=status.HTTP_400_BAD_REQUEST)

        deleted_count = UserAnimeList.objects.filter(id__in=ids).delete()[0]

        return Response({"message": f"{deleted_count} list entries deleted successfully."})


class AdminFavoritesViewSet(viewsets.ViewSet):
    """User favorites management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all user favorites."""
        queryset = UserFavorite.objects.select_related("user", "anime").order_by("-added_at")

        # Filters
        user_id = request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        anime_id = request.query_params.get("anime")
        if anime_id:
            queryset = queryset.filter(anime_id=anime_id)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

        favorites_data = [
            {
                "id": fav.id,
                "user": {
                    "id": fav.user.id,
                    "username": fav.user.username,
                },
                "anime": {
                    "id": fav.anime.id,
                    "title": fav.anime.title,
                    "slug": fav.anime.slug,
                },
                "added_at": fav.added_at.isoformat(),
            }
            for fav in page
        ]

        return paginator.get_paginated_response(favorites_data)

    def destroy(self, request, pk=None):
        """Delete a favorite."""
        try:
            favorite = UserFavorite.objects.get(pk=pk)
        except UserFavorite.DoesNotExist:
            return Response({"detail": "Favorite not found."}, status=status.HTTP_404_NOT_FOUND)

        favorite.delete()

        return Response({"message": "Favorite deleted successfully."})

    @action(detail=False, methods=["post"])
    def bulk_delete(self, request):
        """Bulk delete favorites."""
        ids = request.data.get("ids", [])
        if not ids:
            return Response({"detail": "No IDs provided."}, status=status.HTTP_400_BAD_REQUEST)

        deleted_count = UserFavorite.objects.filter(id__in=ids).delete()[0]

        return Response({"message": f"{deleted_count} favorites deleted successfully."})

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get favorites statistics."""
        total = UserFavorite.objects.count()

        # Most favorited anime
        top_anime = (
            UserFavorite.objects.values("anime__id", "anime__title", "anime__slug")
            .annotate(count=Count("id"))
            .order_by("-count")[:10]
        )

        # Recent favorites
        recent = UserFavorite.objects.select_related("user", "anime").order_by("-added_at")[:5]
        recent_data = [
            {
                "id": f.id,
                "user": f.user.username,
                "anime": f.anime.title,
                "added_at": f.added_at.isoformat(),
            }
            for f in recent
        ]

        return Response(
            {
                "total": total,
                "top_anime": list(top_anime),
                "recent": recent_data,
            }
        )


class AdminBulkOperationsView(APIView):
    """Bulk operations for various entities."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        operation = request.data.get("operation")
        entity = request.data.get("entity")
        ids = request.data.get("ids", [])
        data = request.data.get("data", {})

        if not operation or not entity or not ids:
            return Response(
                {"detail": "operation, entity, and ids are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Map entities to their models
        entity_map = {
            "anime": Anime,
            "users": User,
            "reviews": Review,
            "genres": Genre,
            "studios": Studio,
            "user_lists": UserAnimeList,
            "favorites": UserFavorite,
        }

        if entity not in entity_map:
            return Response(
                {"detail": f"Unknown entity: {entity}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        model = entity_map[entity]
        queryset = model.objects.filter(id__in=ids)

        try:
            if operation == "delete":
                count = queryset.delete()[0]
                return Response({"message": f"{count} {entity} deleted successfully."})

            elif operation == "update" and entity == "anime":
                # Bulk update anime fields
                updates = {}
                if "status" in data:
                    updates["status"] = data["status"]
                if "anime_type" in data:
                    updates["anime_type"] = data["anime_type"]

                count = queryset.update(**updates)
                return Response({"message": f"{count} {entity} updated successfully."})

            elif operation == "update" and entity == "users":
                updates = {}
                if "is_active" in data:
                    updates["is_active"] = data["is_active"]
                if "is_staff" in data:
                    updates["is_staff"] = data["is_staff"]

                count = queryset.update(**updates)
                return Response({"message": f"{count} {entity} updated successfully."})

            else:
                return Response(
                    {"detail": f"Operation {operation} not supported for {entity}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AdminReportsView(APIView):
    """Advanced reporting and analytics."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        report_type = request.query_params.get("type", "overview")
        days = int(request.query_params.get("days", 30))
        start_date = timezone.now() - timedelta(days=days)

        if report_type == "overview":
            return self._get_overview_report(start_date, days)
        elif report_type == "users":
            return self._get_user_report(start_date, days)
        elif report_type == "content":
            return self._get_content_report(start_date, days)
        elif report_type == "engagement":
            return self._get_engagement_report(start_date, days)
        else:
            return Response({"detail": "Unknown report type."}, status=status.HTTP_400_BAD_REQUEST)

    def _get_overview_report(self, start_date, days):
        """Get overall platform statistics."""
        # User growth
        user_growth = (
            User.objects.filter(date_joined__gte=start_date)
            .annotate(date=TruncDate("date_joined"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )

        # Daily active users (users who logged in)
        active_users = User.objects.filter(last_login__gte=start_date).count()

        # Content added
        anime_added = Anime.objects.filter(created_at__gte=start_date).count()
        reviews_added = Review.objects.filter(created_at__gte=start_date).count()

        return Response(
            {
                "period_days": days,
                "users": {
                    "new": User.objects.filter(date_joined__gte=start_date).count(),
                    "active": active_users,
                    "growth_by_day": list(user_growth),
                },
                "content": {
                    "anime_added": anime_added,
                    "reviews_added": reviews_added,
                },
                "engagement": {
                    "favorites_added": UserFavorite.objects.filter(
                        added_at__gte=start_date
                    ).count(),
                    "list_updates": UserAnimeList.objects.filter(
                        updated_at__gte=start_date
                    ).count(),
                },
            }
        )

    def _get_user_report(self, start_date, days):
        """Get detailed user activity report."""
        # Most active users
        active_users = User.objects.annotate(
            list_count=Count("anime_lists"),
            review_count=Count("reviews"),
            favorite_count=Count("favorites"),
        ).order_by("-list_count")[:20]

        active_users_data = [
            {
                "id": u.id,
                "username": u.username,
                "list_entries": u.list_count,
                "reviews": u.review_count,
                "favorites": u.favorite_count,
                "date_joined": u.date_joined.isoformat(),
            }
            for u in active_users
        ]

        # Registration sources (if tracked)
        # This would require additional tracking in your user model

        return Response(
            {
                "period_days": days,
                "total_users": User.objects.count(),
                "new_users": User.objects.filter(date_joined__gte=start_date).count(),
                "active_users": active_users_data,
            }
        )

    def _get_content_report(self, start_date, days):
        """Get content statistics report."""
        # Anime by status
        anime_by_status = dict(Anime.objects.values_list("status").annotate(count=Count("id")))

        # Anime by type
        anime_by_type = dict(Anime.objects.values_list("anime_type").annotate(count=Count("id")))

        # Top genres
        from apps.animes.models import Genre

        top_genres = (
            Genre.objects.annotate(anime_count=Count("anime"))
            .order_by("-anime_count")[:10]
            .values("name", "anime_count")
        )

        # Missing metadata
        missing_cover = Anime.objects.filter(cover_image="").count()
        missing_synopsis = Anime.objects.filter(synopsis="").count()
        missing_studio = Anime.objects.filter(studio__isnull=True).count()

        return Response(
            {
                "period_days": days,
                "total_anime": Anime.objects.count(),
                "new_anime": Anime.objects.filter(created_at__gte=start_date).count(),
                "by_status": anime_by_status,
                "by_type": anime_by_type,
                "top_genres": list(top_genres),
                "missing_metadata": {
                    "cover_image": missing_cover,
                    "synopsis": missing_synopsis,
                    "studio": missing_studio,
                },
            }
        )

    def _get_engagement_report(self, start_date, days):
        """Get user engagement report."""
        # Reviews by rating
        reviews_by_rating = dict(Review.objects.values_list("rating").annotate(count=Count("id")))

        # List status distribution
        list_by_status = dict(
            UserAnimeList.objects.values_list("status").annotate(count=Count("id"))
        )

        # Most reviewed anime
        most_reviewed = (
            Anime.objects.annotate(review_count=Count("reviews"))
            .order_by("-review_count")[:10]
            .values("title", "slug", "review_count")
        )

        # Most favorited anime
        most_favorited = (
            Anime.objects.annotate(favorite_count=Count("favorites"))
            .order_by("-favorite_count")[:10]
            .values("title", "slug", "favorite_count")
        )

        return Response(
            {
                "period_days": days,
                "total_reviews": Review.objects.count(),
                "new_reviews": Review.objects.filter(created_at__gte=start_date).count(),
                "reviews_by_rating": reviews_by_rating,
                "list_by_status": list_by_status,
                "most_reviewed": list(most_reviewed),
                "most_favorited": list(most_favorited),
            }
        )


class AdminSystemLogViewSet(viewsets.ViewSet):
    """System logs management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all system logs with filtering."""
        queryset = SystemLog.objects.select_related("user").all()

        # Filter by level
        level = request.query_params.get("level")
        if level:
            queryset = queryset.filter(level=level.upper())

        # Filter by log type
        log_type = request.query_params.get("log_type")
        if log_type:
            queryset = queryset.filter(log_type=log_type.upper())

        # Filter by user
        user_id = request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        # Filter by date range
        start_date = request.query_params.get("start_date")
        if start_date:
            try:
                start = datetime.strptime(start_date, "%Y-%m-%d")
                queryset = queryset.filter(timestamp__gte=start)
            except ValueError:
                pass

        end_date = request.query_params.get("end_date")
        if end_date:
            try:
                end = datetime.strptime(end_date, "%Y-%m-%d")
                end = end.replace(hour=23, minute=59, second=59)
                queryset = queryset.filter(timestamp__lte=end)
            except ValueError:
                pass

        # Search in message
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(Q(message__icontains=search) | Q(details__icontains=search))

        # Filter by path
        path = request.query_params.get("path")
        if path:
            queryset = queryset.filter(path__icontains=path)

        # Filter by status code
        status_code = request.query_params.get("status_code")
        if status_code:
            queryset = queryset.filter(status_code=status_code)

        # Sorting
        ordering = request.query_params.get("ordering", "-timestamp")
        valid_orderings = ["timestamp", "-timestamp", "level", "-level"]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

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
                    if log.user
                    else None,
                    "user_ip": log.user_ip,
                    "method": log.method,
                    "path": log.path,
                    "status_code": log.status_code,
                    "message": log.message,
                    "details": log.details,
                    "duration_ms": log.duration_ms,
                }
            )

        return paginator.get_paginated_response(logs_data)

    def retrieve(self, request, pk=None):
        """Get detailed log information."""
        try:
            log = SystemLog.objects.select_related("user").get(pk=pk)
        except SystemLog.DoesNotExist:
            return Response({"detail": "Log entry not found."}, status=status.HTTP_404_NOT_FOUND)

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
                if log.user
                else None,
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
        from django.db.models import Count

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


class AdminAuditLogViewSet(viewsets.ViewSet):
    """Audit logs management for admins."""

    permission_classes = [IsAdminUser]
    pagination_class = AdminPagination

    def list(self, request):
        """List all audit logs with filtering."""
        queryset = AuditLog.objects.select_related("user").all()

        # Filter by action
        action = request.query_params.get("action")
        if action:
            queryset = queryset.filter(action=action.upper())

        # Filter by entity type
        entity_type = request.query_params.get("entity_type")
        if entity_type:
            queryset = queryset.filter(entity_type__iexact=entity_type)

        # Filter by user
        user_id = request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        # Filter by date range
        start_date = request.query_params.get("start_date")
        if start_date:
            try:
                start = datetime.strptime(start_date, "%Y-%m-%d")
                queryset = queryset.filter(timestamp__gte=start)
            except ValueError:
                pass

        end_date = request.query_params.get("end_date")
        if end_date:
            try:
                end = datetime.strptime(end_date, "%Y-%m-%d")
                end = end.replace(hour=23, minute=59, second=59)
                queryset = queryset.filter(timestamp__lte=end)
            except ValueError:
                pass

        # Search in entity representation
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(
                Q(entity_repr__icontains=search)
                | Q(entity_type__icontains=search)
                | Q(user__username__icontains=search)
            )

        # Sorting
        ordering = request.query_params.get("ordering", "-timestamp")
        valid_orderings = ["timestamp", "-timestamp", "action", "-action"]
        if ordering in valid_orderings:
            queryset = queryset.order_by(ordering)

        # Pagination
        paginator = AdminPagination()
        page = paginator.paginate_queryset(queryset, request)

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
                    if log.user
                    else None,
                    "user_ip": log.user_ip,
                    "action": log.action,
                    "entity_type": log.entity_type,
                    "entity_id": log.entity_id,
                    "entity_repr": log.entity_repr,
                    "changes": log.changes,
                    "metadata": log.metadata,
                }
            )

        return paginator.get_paginated_response(logs_data)

    def retrieve(self, request, pk=None):
        """Get detailed audit log information."""
        try:
            log = AuditLog.objects.select_related("user").get(pk=pk)
        except AuditLog.DoesNotExist:
            return Response(
                {"detail": "Audit log entry not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat(),
                "user": {
                    "id": log.user.id,
                    "username": log.user.username,
                }
                if log.user
                else None,
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
        from django.db.models import Count

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
