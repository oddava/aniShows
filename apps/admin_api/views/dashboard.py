from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.animes.models import Anime, Genre, Review, Studio, UserFavorite, UserHistory
from apps.core.permissions import IsAdminUser
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()


class AdminDashboardView(APIView):
    """Dashboard statistics and overview data."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        now = timezone.now()
        last_7_days = now - timedelta(days=7)
        last_30_days = now - timedelta(days=30)
        user_queryset = User.objects.all()
        profile_queryset = UserProfile.objects.all()
        anime_queryset = Anime.objects.all()
        review_queryset = Review.objects.all()
        favorite_queryset = UserFavorite.objects.all()
        list_entry_queryset = UserAnimeList.objects.all()

        # User statistics
        total_users = user_queryset.count()
        new_users_7d = user_queryset.filter(date_joined__gte=last_7_days).count()
        new_users_30d = user_queryset.filter(date_joined__gte=last_30_days).count()
        verified_users = profile_queryset.filter(email_verified=True).count()

        # Content statistics
        total_anime = anime_queryset.count()
        airing_anime = anime_queryset.filter(status="Airing").count()
        total_reviews = review_queryset.count()
        new_reviews_7d = review_queryset.filter(created_at__gte=last_7_days).count()

        # Engagement statistics
        total_favorites = favorite_queryset.count()
        total_list_entries = list_entry_queryset.count()

        # User growth (last 30 days)
        user_growth = (
            user_queryset.filter(date_joined__gte=last_30_days)
            .annotate(date=TruncDate("date_joined"))
            .values("date")
            .annotate(count=Count("id"))
            .order_by("date")
        )

        # Popular anime (most favorites)
        popular_anime = (
            anime_queryset.annotate(favorite_count=Count("favorites"))
            .order_by("-favorite_count")[:5]
            .values("id", "title", "slug", "cover_image", "favorite_count")
        )

        # Recent reviews
        recent_reviews = review_queryset.select_related("user", "anime").order_by("-created_at")[:5]

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
        recent_users = user_queryset.order_by("-date_joined")[:5].values(
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


class AdminStatsExportView(APIView):
    """Export statistics data for admins."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        """Export summary statistics as JSON."""
        now = timezone.now()
        user_queryset = User.objects.all()
        anime_queryset = Anime.objects.all()
        genre_queryset = Genre.objects.all()
        studio_queryset = Studio.objects.all()
        review_queryset = Review.objects.all()
        favorite_queryset = UserFavorite.objects.all()
        list_entry_queryset = UserAnimeList.objects.all()
        history_queryset = UserHistory.objects.all()

        # Gather comprehensive stats
        stats = {
            "generated_at": now.isoformat(),
            "users": {
                "total": user_queryset.count(),
                "active": user_queryset.filter(is_active=True).count(),
                "staff": user_queryset.filter(is_staff=True).count(),
                "superusers": user_queryset.filter(is_superuser=True).count(),
            },
            "content": {
                "anime": {
                    "total": anime_queryset.count(),
                    "by_status": dict(
                        anime_queryset.values_list("status").annotate(count=Count("id"))
                    ),
                    "by_type": dict(
                        anime_queryset.values_list("anime_type").annotate(count=Count("id"))
                    ),
                },
                "genres": genre_queryset.count(),
                "studios": studio_queryset.count(),
            },
            "engagement": {
                "reviews": review_queryset.count(),
                "favorites": favorite_queryset.count(),
                "list_entries": list_entry_queryset.count(),
                "history_entries": history_queryset.count(),
            },
        }

        return Response(stats)
