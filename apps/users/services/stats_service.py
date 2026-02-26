"""
User Stats Service
Provides functions for calculating user statistics on-the-fly
when UserStats materialized view is not available.
"""

from django.db.models import Sum, Avg
from apps.users.models import UserAnimeList, UserStats
from apps.animes.models import UserFavorite, Review


def calculate_user_stats(user):
    """
    Calculate user stats on-the-fly from UserAnimeList and related models.

    This is used as a fallback when the UserStats materialized view
    doesn't exist or is stale.

    Args:
        user: User instance

    Returns:
        dict: Dictionary containing all user statistics
    """
    # Get all user's anime lists
    lists = UserAnimeList.objects.filter(user=user)

    # Basic counts
    anime_count = lists.count()

    # Episodes watched
    episodes_watched = lists.aggregate(total=Sum("episodes_watched"))["total"] or 0

    # Calculate total minutes watched
    # Join with anime to get episode duration (default to 24 minutes)
    total_minutes = 0
    for item in lists.select_related("anime").iterator():
        duration = item.anime.duration_minutes if item.anime and item.anime.duration_minutes else 24
        total_minutes += item.episodes_watched * duration

    days_watched = round(total_minutes / 1440, 1)  # 1440 minutes in a day

    # Mean score from rated anime
    rated_items = lists.filter(score__gt=0)
    mean_score = rated_items.aggregate(avg=Avg("score"))["avg"]

    # Favorites count
    favorites_count = UserFavorite.objects.filter(user=user).count()

    # Reviews count
    reviews_count = Review.objects.filter(user=user).count()

    return {
        "anime_count": anime_count,
        "episodes_watched": episodes_watched,
        "total_minutes": total_minutes,
        "days_watched": days_watched,
        "mean_score": round(mean_score, 1) if mean_score else None,
        "favorites_count": favorites_count,
        "reviews_count": reviews_count,
    }


def create_or_update_user_stats(user):
    """
    Create or update the UserStats materialized view for a user.

    Args:
        user: User instance

    Returns:
        UserStats: The created or updated UserStats instance
    """
    stats_data = calculate_user_stats(user)

    stats, created = UserStats.objects.update_or_create(
        user=user,
        defaults={
            "anime_count": stats_data["anime_count"],
            "episodes_watched": stats_data["episodes_watched"],
            "total_minutes": stats_data["total_minutes"],
            "days_watched": stats_data["days_watched"],
            "mean_score": stats_data["mean_score"],
            "favorites_count": stats_data["favorites_count"],
            "reviews_count": stats_data["reviews_count"],
        },
    )

    return stats


def get_user_stats_with_fallback(user):
    """
    Get user stats, falling back to on-the-fly calculation if UserStats doesn't exist.

    Args:
        user: User instance

    Returns:
        dict: User statistics dictionary
    """
    try:
        stats = user.stats
        return {
            "anime_count": stats.anime_count,
            "episodes_watched": stats.episodes_watched,
            "total_minutes": stats.total_minutes,
            "days_watched": stats.days_watched,
            "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
            "favorites_count": stats.favorites_count,
            "reviews_count": stats.reviews_count,
            "followers_count": stats.followers_count,
            "following_count": stats.following_count,
        }
    except UserStats.DoesNotExist:
        # Fall back to on-the-fly calculation
        return calculate_user_stats(user)
