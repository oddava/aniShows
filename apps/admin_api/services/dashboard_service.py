from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.animes.models import Anime, Genre, Review, Studio, UserFavorite, UserHistory
from apps.users.models import UserAnimeList, UserProfile

User = get_user_model()


def build_admin_dashboard_payload():
    now = timezone.now()
    last_7_days = now - timedelta(days=7)
    last_30_days = now - timedelta(days=30)
    user_queryset = User.objects.all()
    profile_queryset = UserProfile.objects.all()
    anime_queryset = Anime.objects.all()
    review_queryset = Review.objects.all()
    favorite_queryset = UserFavorite.objects.all()
    list_entry_queryset = UserAnimeList.objects.all()

    user_growth = (
        user_queryset.filter(date_joined__gte=last_30_days)
        .annotate(date=TruncDate("date_joined"))
        .values("date")
        .annotate(count=Count("id"))
        .order_by("date")
    )
    popular_anime = (
        anime_queryset.annotate(favorite_count=Count("favorites"))
        .order_by("-favorite_count")[:5]
        .values("id", "title", "slug", "cover_image", "favorite_count")
    )
    recent_reviews = review_queryset.select_related("user", "anime").order_by("-created_at")[:5]
    recent_reviews_data = [
        {
            "id": review.id,
            "user": review.user.username,
            "anime": review.anime.title,
            "anime_slug": review.anime.slug,
            "rating": review.rating,
            "has_spoilers": review.has_spoilers,
            "created_at": review.created_at.isoformat(),
        }
        for review in recent_reviews
    ]
    recent_users = user_queryset.order_by("-date_joined")[:5].values(
        "id", "username", "email", "date_joined", "is_active", "is_staff"
    )

    return {
        "statistics": {
            "users": {
                "total": user_queryset.count(),
                "new_7d": user_queryset.filter(date_joined__gte=last_7_days).count(),
                "new_30d": user_queryset.filter(date_joined__gte=last_30_days).count(),
                "verified": profile_queryset.filter(email_verified=True).count(),
            },
            "content": {
                "total_anime": anime_queryset.count(),
                "airing_anime": anime_queryset.filter(status="Airing").count(),
                "total_reviews": review_queryset.count(),
                "new_reviews_7d": review_queryset.filter(created_at__gte=last_7_days).count(),
            },
            "engagement": {
                "total_favorites": favorite_queryset.count(),
                "total_list_entries": list_entry_queryset.count(),
            },
        },
        "charts": {"user_growth": list(user_growth)},
        "popular_anime": list(popular_anime),
        "recent_reviews": recent_reviews_data,
        "recent_users": list(recent_users),
    }


def build_admin_stats_export_payload():
    now = timezone.now()
    user_queryset = User.objects.all()
    anime_queryset = Anime.objects.all()
    genre_queryset = Genre.objects.all()
    studio_queryset = Studio.objects.all()
    review_queryset = Review.objects.all()
    favorite_queryset = UserFavorite.objects.all()
    list_entry_queryset = UserAnimeList.objects.all()
    history_queryset = UserHistory.objects.all()

    return {
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
                "by_status": dict(anime_queryset.values_list("status").annotate(count=Count("id"))),
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
