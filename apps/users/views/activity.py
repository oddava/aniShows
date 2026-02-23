from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model
from django.db.models import Sum, F, Case, When, IntegerField, Value
from django.db.models.functions import TruncDate, Coalesce, Greatest
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
        queryset = UserActivity.objects.select_related(
            "anime", "anime__studio"
        ).prefetch_related("anime__genres")

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

        data = (
            UserActivity.objects.filter(
                user=user_filter,
                created_at__gte=one_year_ago,
                activity_type__in=episode_types,
            )
            .annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(
                count=Greatest(
                    Coalesce(
                        Sum(
                            Case(
                                # For progress: sum (new_episodes - old_episodes)
                                When(
                                    activity_type=UserActivity.ActivityType.PROGRESS,
                                    old_episodes__isnull=False,
                                    new_episodes__isnull=False,
                                    then=F("new_episodes") - F("old_episodes"),
                                ),
                                # For completed with old_episodes: use diff
                                When(
                                    activity_type=UserActivity.ActivityType.COMPLETED,
                                    old_episodes__isnull=False,
                                    new_episodes__isnull=False,
                                    then=F("new_episodes") - F("old_episodes"),
                                ),
                                # For completed without old_episodes: use total
                                When(
                                    activity_type=UserActivity.ActivityType.COMPLETED,
                                    old_episodes__isnull=True,
                                    new_episodes__isnull=False,
                                    then=F("new_episodes"),
                                ),
                                default=Value(1),
                                output_field=IntegerField(),
                            )
                        ),
                        Value(0),
                    ),
                    Value(0),  # Clamp negative diffs to 0
                )
            )
            .order_by("date")
        )

        result = [
            {"date": entry["date"].isoformat(), "count": entry["count"]}
            for entry in data
            if entry["count"] > 0
        ]

        # Cache result for 5 minutes
        redis_cache.set(cache_key, result, timeout=HEATMAP_CACHE_TIMEOUT)

        return Response(result)

