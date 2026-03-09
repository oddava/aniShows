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
