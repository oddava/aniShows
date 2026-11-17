from dataclasses import dataclass

from django.utils import timezone

from ...shared.public_cache import best_effort_get, best_effort_set
from ..models import UserStats
from .cache import get_user_stats_cache_key
from .stats_service import (
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
    cached_data = best_effort_get(cache_key, source="user stats")
    if cached_data:
        return UserStatsResult(data=cached_data, cache_hit=True)

    try:
        stats = UserStats.objects.get(user=user)
        data = get_materialized_user_stats_payload(stats, include_last_updated=True)
        best_effort_set(cache_key, data, 300, source="user stats")
        return UserStatsResult(data=data, cache_hit=False)
    except UserStats.DoesNotExist:
        pass

    data = serialize_user_stats(calculate_user_stats(user), include_last_updated=True)
    data["last_updated"] = timezone.now()

    best_effort_set(cache_key, data, 300, source="user stats")
    return UserStatsResult(data=data, cache_hit=False)
