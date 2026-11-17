from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Case, F, IntegerField, Q, Sum, Value, When
from django.db.models.functions import Greatest, TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ...animes.models import Anime
from ...shared.public_cache import best_effort_get, best_effort_set
from ..models import UserActivity, UserAnimeList

try:
    from .cache import get_user_heatmap_cache_key
except ImportError:
    # Backward-compatible fallback for environments that still run older cache service code.
    def get_user_heatmap_cache_key(user_id):
        return f"heatmap:{user_id}"


User = get_user_model()

HEATMAP_CACHE_TIMEOUT = 300


def _is_private(target_user, request_user) -> bool:
    if request_user.is_authenticated and target_user == request_user:
        return False
    profile = getattr(target_user, "userprofile", None)
    return bool(profile and profile.is_private)


def resolve_activity_user(username, request_user):
    if username:
        target_user = get_object_or_404(
            User.objects.select_related("userprofile"), username=username
        )
        if _is_private(target_user, request_user):
            return None
        return target_user

    if request_user.is_authenticated:
        return request_user

    return None


def build_activity_queryset(request):
    username = request.query_params.get("username")
    target_user = resolve_activity_user(username, request.user)
    if target_user is None:
        return UserActivity.objects.none()

    queryset = UserActivity.objects.select_related("anime").prefetch_related(
        "anime__genres", Anime.studios_prefetch("anime__")
    )
    queryset = queryset.filter(user=target_user)

    activity_type = request.query_params.get("type")
    if activity_type:
        if activity_type not in UserActivity.ActivityType.values:
            raise ValidationError({"type": f"Unknown activity type '{activity_type}'."})
        queryset = queryset.filter(activity_type=activity_type)

    # The feed's status filter ("Completed", "Plan to Watch", ...): rows that moved an
    # entry into that status, or removed one that was in it.
    list_status = request.query_params.get("status")
    if list_status:
        if list_status not in UserAnimeList.UserAnimeStatus.values:
            raise ValidationError({"status": f"Unknown status '{list_status}'."})
        removed = UserActivity.ActivityType.REMOVED
        queryset = queryset.filter(
            (~Q(activity_type=removed) & Q(new_status=list_status))
            | Q(activity_type=removed, old_status=list_status)
        )

    return queryset.order_by("-created_at")


def get_heatmap_data(request):
    username = request.query_params.get("username")
    target_user = resolve_activity_user(username, request.user)
    if target_user is None:
        return []

    cache_key = get_user_heatmap_cache_key(target_user.id)
    cached = best_effort_get(cache_key, source="activity heatmap")
    if cached is not None:
        return cached

    one_year_ago = timezone.now() - timedelta(days=365)
    episode_types = [
        UserActivity.ActivityType.PROGRESS,
        UserActivity.ActivityType.COMPLETED,
    ]

    activities = (
        UserActivity.objects.filter(
            user=target_user,
            created_at__gte=one_year_ago,
            activity_type__in=episode_types,
        )
        .annotate(
            activity_date=TruncDate("created_at"),
            ep_count=Greatest(
                Case(
                    When(
                        old_episodes__isnull=False,
                        new_episodes__isnull=False,
                        then=F("new_episodes") - F("old_episodes"),
                    ),
                    When(
                        new_episodes__isnull=False,
                        then=F("new_episodes"),
                    ),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
                Value(0),
                output_field=IntegerField(),
            ),
        )
        .values("activity_date")
        .annotate(total_count=Sum("ep_count"))
        .filter(total_count__gt=0)
        .order_by("activity_date")
    )

    result = [
        {"date": entry["activity_date"].isoformat(), "count": entry["total_count"]}
        for entry in activities
    ]

    best_effort_set(cache_key, result, HEATMAP_CACHE_TIMEOUT, source="activity heatmap")
    return result
