from dataclasses import dataclass

from django.core.cache import cache
from django.db.models import Avg, F, Sum
from django.utils import timezone

from apps.users.models import UserAnimeList, UserStats
from apps.users.services.cache import get_user_stats_cache_key


@dataclass(slots=True)
class UserStatsResult:
    data: dict
    cache_hit: bool


def get_user_stats(user) -> UserStatsResult:
    cache_key = get_user_stats_cache_key(user.id)
    cached_data = cache.get(cache_key)
    if cached_data:
        return UserStatsResult(data=cached_data, cache_hit=True)

    try:
        stats = UserStats.objects.get(user=user)
        data = {
            "favorites_count": stats.favorites_count,
            "reviews_count": stats.reviews_count,
            "anime_count": stats.anime_count,
            "episodes_watched": stats.episodes_watched,
            "total_minutes": getattr(stats, "total_minutes", 0),
            "days_watched": round(stats.days_watched, 1),
            "mean_score": round(stats.mean_score, 1) if stats.mean_score else 0,
            "last_updated": stats.last_updated,
        }
        cache.set(cache_key, data, timeout=300)
        return UserStatsResult(data=data, cache_hit=False)
    except UserStats.DoesNotExist:
        pass

    favorites_count = user.favorites.count()
    reviews_count = user.reviews.count()
    anime_count = UserAnimeList.objects.filter(user=user).count()

    episodes_watched = (
        UserAnimeList.objects.filter(user=user).aggregate(
            total=Sum("episodes_watched")
        )["total"]
        or 0
    )

    total_minutes = (
        UserAnimeList.objects.filter(user=user)
        .annotate(entry_minutes=F("episodes_watched") * F("anime__duration_minutes"))
        .aggregate(total=Sum("entry_minutes"))["total"]
        or 0
    )

    mean_score = UserAnimeList.objects.filter(user=user, score__gt=0).aggregate(
        avg=Avg("score")
    )["avg"]

    days_watched = total_minutes / 1440.0

    data = {
        "favorites_count": favorites_count,
        "reviews_count": reviews_count,
        "anime_count": anime_count,
        "episodes_watched": episodes_watched,
        "total_minutes": total_minutes,
        "days_watched": round(days_watched, 1),
        "mean_score": round(mean_score, 1) if mean_score else 0,
        "last_updated": timezone.now(),
    }

    cache.set(cache_key, data, timeout=300)
    return UserStatsResult(data=data, cache_hit=False)
