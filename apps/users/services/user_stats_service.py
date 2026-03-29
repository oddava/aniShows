from dataclasses import dataclass

from django.core.cache import cache
from django.utils import timezone

from apps.users.models import UserStats
from apps.users.services.cache import get_user_stats_cache_key
from apps.users.services.stats_service import (
    calculate_user_stats,
    get_materialized_user_stats_payload,
    serialize_user_stats,
)


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
        data = get_materialized_user_stats_payload(stats, include_last_updated=True)
        cache.set(cache_key, data, timeout=300)
        return UserStatsResult(data=data, cache_hit=False)
    except UserStats.DoesNotExist:
        pass

    data = serialize_user_stats(calculate_user_stats(user), include_last_updated=True)
    data["last_updated"] = timezone.now()

    cache.set(cache_key, data, timeout=300)
    return UserStatsResult(data=data, cache_hit=False)
