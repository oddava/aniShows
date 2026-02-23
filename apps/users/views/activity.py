from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model
from django.core.cache import cache as redis_cache

from apps.users.models import UserActivity
from apps.animes.serializers import UserActivitySerializer

User = get_user_model()

# Cache heatmap data for 5 minutes per user
HEATMAP_CACHE_TIMEOUT = 300


def _check_privacy(target_user, request_user):
    """Check if request_user can view target_user's activity.

    Returns True if the profile is private and the viewer is not the owner.
    """
    if request_user.is_authenticated and target_user == request_user:
        return False  # Own profile, always visible
    profile = getattr(target_user, "userprofile", None)
    return profile and profile.is_private


class UserActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only viewset for user activity feed and heatmap data."""

    serializer_class = UserActivitySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        username = self.request.query_params.get("username")
        queryset = UserActivity.objects.select_related("anime", "anime__studio").prefetch_related(
            "anime__genres"
        )

        if username:
            target_user = get_object_or_404(User, username=username)
            if _check_privacy(target_user, self.request.user):
                return UserActivity.objects.none()
            queryset = queryset.filter(user=target_user)
        elif self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)
        else:
            return UserActivity.objects.none()

        # Optional activity type filter
        activity_type = self.request.query_params.get("type")
        if activity_type:
            queryset = queryset.filter(activity_type=activity_type)

        return queryset.order_by("-created_at")

    @action(detail=False, methods=["get"])
    def heatmap(self, request):
        """Return aggregated episodes watched per day for the past year.

        Only counts progress and completed activities, summing the actual
        episode diffs (new_episodes - old_episodes) per day. Negative diffs
        (e.g. from rewatching) are clamped to 0.

        Response format: [{"date": "2026-02-20", "count": 4}, ...]
        """
        username = request.query_params.get("username")

        if username:
            target_user = get_object_or_404(User, username=username)
            if _check_privacy(target_user, request.user):
                return Response([])
            user_filter = target_user
        elif request.user.is_authenticated:
            user_filter = request.user
        else:
            return Response([])

        # Check Redis cache first
        cache_key = f"heatmap:{user_filter.id}"
        cached = redis_cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        from django.utils import timezone
        from datetime import timedelta

        one_year_ago = timezone.now() - timedelta(days=365)

        # Only count episode-watching activities
        episode_types = [
            UserActivity.ActivityType.PROGRESS,
            UserActivity.ActivityType.COMPLETED,
        ]

        # Fetch activities and aggregate in Python for reliability
        activities = UserActivity.objects.filter(
            user=user_filter,
            created_at__gte=one_year_ago,
            activity_type__in=episode_types,
        )

        # Aggregate by date
        from collections import defaultdict
        from datetime import date

        daily_counts = defaultdict(int)

        for activity in activities:
            activity_date = activity.created_at.date()

            if activity.activity_type == UserActivity.ActivityType.PROGRESS:
                # For progress: count episodes watched (diff)
                if activity.old_episodes is not None and activity.new_episodes is not None:
                    count = activity.new_episodes - activity.old_episodes
                elif activity.new_episodes is not None:
                    count = activity.new_episodes
                else:
                    count = 1
            elif activity.activity_type == UserActivity.ActivityType.COMPLETED:
                # For completed: use diff if old_episodes exists, otherwise use total
                if activity.old_episodes is not None and activity.new_episodes is not None:
                    count = activity.new_episodes - activity.old_episodes
                elif activity.new_episodes is not None:
                    count = activity.new_episodes
                else:
                    count = 1
            else:
                count = 1

            # Clamp negative diffs to 0
            if count > 0:
                daily_counts[activity_date] += count

        # Convert to sorted list
        result = [
            {"date": d.isoformat(), "count": c} for d, c in sorted(daily_counts.items()) if c > 0
        ]

        # Cache result for 5 minutes
        redis_cache.set(cache_key, result, timeout=HEATMAP_CACHE_TIMEOUT)

        return Response(result)
