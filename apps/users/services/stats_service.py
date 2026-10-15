"""
User Stats Service
Provides functions for calculating user statistics on-the-fly
when UserStats materialized view is not available.
"""

from django.db.models import Avg, Count, F, Q, Sum, Value
from django.db.models.functions import Coalesce

from ...animes.models import Review, ReviewVote, UserFavorite
from ..models import UserAnimeList, UserFollow, UserStats


def serialize_user_stats(
    stats_data: dict,
    *,
    include_follow_counts: bool = False,
    include_last_updated=False,
):
    payload = {
        "anime_count": int(stats_data.get("anime_count", 0) or 0),
        "episodes_watched": int(stats_data.get("episodes_watched", 0) or 0),
        "total_minutes": int(stats_data.get("total_minutes", 0) or 0),
        "days_watched": round(float(stats_data.get("days_watched", 0) or 0), 1),
        "mean_score": round(stats_data["mean_score"], 1) if stats_data.get("mean_score") else None,
        "favorites_count": int(stats_data.get("favorites_count", 0) or 0),
        "reviews_count": int(stats_data.get("reviews_count", 0) or 0),
        "resonance_count": int(stats_data.get("resonance_count", 0) or 0),
    }
    if include_follow_counts:
        payload["followers_count"] = int(stats_data.get("followers_count", 0) or 0)
        payload["following_count"] = int(stats_data.get("following_count", 0) or 0)
    if include_last_updated:
        payload["last_updated"] = stats_data.get("last_updated")
    return payload


def get_materialized_user_stats_payload(
    stats: UserStats,
    *,
    include_follow_counts: bool = False,
    include_last_updated: bool = False,
):
    stats_data = {
        "anime_count": stats.anime_count,
        "episodes_watched": stats.episodes_watched,
        "total_minutes": stats.total_minutes,
        "days_watched": stats.days_watched,
        "mean_score": stats.mean_score,
        "favorites_count": stats.favorites_count,
        "reviews_count": stats.reviews_count,
        "resonance_count": stats.resonance_count,
        "followers_count": stats.followers_count,
        "following_count": stats.following_count,
        "last_updated": stats.last_updated,
    }
    return serialize_user_stats(
        stats_data,
        include_follow_counts=include_follow_counts,
        include_last_updated=include_last_updated,
    )


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

    # Calculate total minutes watched using DB aggregation (no Python loop)
    total_minutes = (
        lists.select_related("anime")
        .annotate(
            duration=Coalesce(F("anime__duration_minutes"), Value(24)),
        )
        .aggregate(total=Sum(F("episodes_watched") * F("duration")))["total"]
        or 0
    )

    days_watched = round(total_minutes / 1440, 1)  # 1440 minutes in a day

    # Mean score from rated anime
    rated_items = lists.filter(score__gt=0)
    mean_score = rated_items.aggregate(avg=Avg("score"))["avg"]

    # Favorites count
    favorites_count = UserFavorite.objects.filter(user=user).count()

    # Reviews count
    reviews_count = Review.objects.filter(user=user).count()

    # Helpful votes received across all of the user's reviews.
    resonance_count = ReviewVote.objects.filter(
        review__user=user,
        vote_type=ReviewVote.VoteType.HELPFUL,
    ).count()

    return {
        "anime_count": anime_count,
        "episodes_watched": episodes_watched,
        "total_minutes": total_minutes,
        "days_watched": days_watched,
        "mean_score": round(mean_score, 1) if mean_score else None,
        "favorites_count": favorites_count,
        "reviews_count": reviews_count,
        "resonance_count": resonance_count,
    }


def calculate_user_stats_with_follows(user):
    stats_data = calculate_user_stats(user)
    follow_counts = UserFollow.objects.aggregate(
        followers_count=Count("id", filter=Q(following=user)),
        following_count=Count("id", filter=Q(follower=user)),
    )
    stats_data.update(follow_counts)
    return stats_data


def create_or_update_user_stats(user):
    """
    Create or update the UserStats materialized view for a user.

    Args:
        user: User instance

    Returns:
        UserStats: The created or updated UserStats instance
    """
    stats_data = calculate_user_stats(user)

    stats, _created = UserStats.objects.update_or_create(
        user=user,
        defaults={
            "anime_count": stats_data["anime_count"],
            "episodes_watched": stats_data["episodes_watched"],
            "total_minutes": stats_data["total_minutes"],
            "days_watched": stats_data["days_watched"],
            "mean_score": stats_data["mean_score"],
            "favorites_count": stats_data["favorites_count"],
            "reviews_count": stats_data["reviews_count"],
            "resonance_count": stats_data["resonance_count"],
        },
    )

    return stats


