from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.cache import cache

from apps.shared.logger import logger
from apps.users.models import UserBadge, UserStats

User = get_user_model()


@dataclass(slots=True)
class ProfileResult:
    data: dict
    cache_hit: bool


def get_current_user_profile(user_id: int, is_full: bool) -> ProfileResult:
    cache_key = f"user_profile:{user_id}:{'full' if is_full else 'light'}"
    cached_data = cache.get(cache_key)
    if cached_data:
        return ProfileResult(data=cached_data, cache_hit=True)

    user = User.objects.select_related("userprofile").get(pk=user_id)
    stats_data = _get_stats_snapshot(user)
    data = _build_profile_data(user, stats_data)

    badges, total_badges_count = get_featured_badges(user)
    data["badges"] = badges
    data["total_badges_count"] = total_badges_count

    cache.set(cache_key, data, timeout=300)
    return ProfileResult(data=data, cache_hit=False)


def get_featured_badges(user):
    featured_badges = (
        UserBadge.objects.filter(user=user, badge__is_active=True, is_featured=True)
        .select_related("badge")
        .order_by("-granted_at")[:3]
    )
    badges = [
        {
            "id": ub.badge.id,
            "name": ub.badge.name,
            "slug": ub.badge.slug,
            "icon": ub.badge.icon,
            "image": ub.badge.image.url if ub.badge.image else None,
            "color": ub.badge.color,
            "description": ub.badge.description,
        }
        for ub in featured_badges
    ]
    total_count = UserBadge.objects.filter(user=user, badge__is_active=True).count()
    return badges, total_count


def is_user_online(user) -> bool:
    from datetime import timedelta

    from django.utils import timezone

    cache_key = f"user_online:{user.id}"
    if cache.get(cache_key) is not None:
        return True

    if user.userprofile and user.userprofile.last_activity:
        time_since = timezone.now() - user.userprofile.last_activity
        if time_since < timedelta(minutes=5):
            return True

    return False


def _get_stats_snapshot(user):
    try:
        stats = UserStats.objects.get(user=user)
        return {
            "followers_count": stats.followers_count,
            "following_count": stats.following_count,
            "anime_count": stats.anime_count,
            "episodes_watched": stats.episodes_watched,
            "total_minutes": getattr(stats, "total_minutes", 0),
            "days_watched": round(stats.days_watched, 1),
            "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
            "favorites_count": stats.favorites_count,
            "reviews_count": stats.reviews_count,
        }
    except UserStats.DoesNotExist:
        from apps.users.services.stats_service import calculate_user_stats

        stats_data = calculate_user_stats(user)
        stats_data["followers_count"] = 0
        stats_data["following_count"] = 0

        from apps.users.tasks import update_user_stats

        update_user_stats.delay(user.id)
        return stats_data


def _build_profile_data(user, stats_data):
    profile = getattr(user, "userprofile", None)
    data = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "date_joined": user.date_joined,
        "avatar": profile.avatar.url if profile and profile.avatar else None,
        "banner": profile.banner.url if profile and profile.banner else None,
        "bio": profile.bio if profile else None,
        "is_private": profile.is_private if profile else False,
        "email_verified": profile.email_verified if profile else False,
        "social_links": profile.social_links if profile else [],
        "points": profile.points if profile else 0,
        "has_password": user.has_usable_password(),
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
    }

    if stats_data:
        data.update(stats_data)

    logger.debug("Built current user profile payload", extra={"user_id": user.id})
    return data
