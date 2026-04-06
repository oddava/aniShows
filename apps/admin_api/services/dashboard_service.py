from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
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
    user_stats = user_queryset.aggregate(
        total=Count("id"),
        new_7d=Count("id", filter=Q(date_joined__gte=last_7_days)),
        new_30d=Count("id", filter=Q(date_joined__gte=last_30_days)),
    )
    content_stats = anime_queryset.aggregate(
        total_anime=Count("id"),
        airing_anime=Count("id", filter=Q(status="Airing")),
    )
    review_stats = review_queryset.aggregate(
        total_reviews=Count("id"),
        new_reviews_7d=Count("id", filter=Q(created_at__gte=last_7_days)),
    )

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
                "total": user_stats["total"],
                "new_7d": user_stats["new_7d"],
                "new_30d": user_stats["new_30d"],
                "verified": profile_queryset.filter(email_verified=True).count(),
            },
            "content": {
                "total_anime": content_stats["total_anime"],
                "airing_anime": content_stats["airing_anime"],
                "total_reviews": review_stats["total_reviews"],
                "new_reviews_7d": review_stats["new_reviews_7d"],
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
    user_stats = user_queryset.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(is_active=True)),
        staff=Count("id", filter=Q(is_staff=True)),
        superusers=Count("id", filter=Q(is_superuser=True)),
    )
    anime_stats = anime_queryset.aggregate(total=Count("id"))

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": user_stats["total"],
            "active": user_stats["active"],
            "staff": user_stats["staff"],
            "superusers": user_stats["superusers"],
        },
        "content": {
            "anime": {
                "total": anime_stats["total"],
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
