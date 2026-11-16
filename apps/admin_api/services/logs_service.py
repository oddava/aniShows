from datetime import timedelta

from django.db.models import Count
from django.utils import timezone


def build_system_log_stats(queryset, *, last_24h_only: bool = True):
    """Counts by level and type. Unfiltered, it covers only the last 24h (bounded cost)."""
    # A list ordering (``-timestamp`` from OrderingFilter) would join the GROUP BY and
    # split one level into many groups.
    queryset = queryset.order_by()
    if last_24h_only:
        queryset = queryset.filter(timestamp__gte=timezone.now() - timedelta(hours=24))
    by_level = dict(queryset.values_list("level").annotate(count=Count("id")))
    by_type = dict(queryset.values_list("log_type").annotate(count=Count("id")))

    last_24h = timezone.now() - timedelta(hours=24)
    recent = queryset.filter(timestamp__gte=last_24h)
    recent_total = recent.count()
    recent_errors = recent.filter(level__in=["ERROR", "CRITICAL"]).count()

    return {
        "by_level": by_level,
        "by_type": by_type,
        "total": sum(by_level.values()),
        "window": "24h" if last_24h_only else "filtered",
        "recent_errors": recent_errors,
        "error_rate": round((recent_errors / recent_total) * 100, 2) if recent_total else 0.0,
    }
