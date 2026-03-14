from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.cache import cache

from apps.users.serializers.users import PublicUserSerializer
from apps.shared.logger import logger
from apps.users.services.cache import get_public_profile_cache_key
from apps.users.services.profile_service import get_featured_badges, is_user_online
from apps.users.services.user_queryset import get_annotated_user_queryset

User = get_user_model()


class PublicProfileError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class PublicProfileResult:
    data: dict
    cache_hit: bool
    source: str


def get_public_profile(username: str, viewer=None, request=None) -> PublicProfileResult:
    is_authenticated = viewer is not None and getattr(viewer, "is_authenticated", False)
    is_own_profile = is_authenticated and viewer.username.lower() == username.lower()
    viewer_id = viewer.id if is_authenticated else "anonymous"

    cache_key = get_public_profile_cache_key(username, viewer_id)
    cached_data = cache.get(cache_key)
    if cached_data:
        if cached_data.get("is_private") and not is_own_profile:
            raise PublicProfileError("Profile not found", 404)
        return PublicProfileResult(data=cached_data, cache_hit=True, source="cache")

    try:
        user = User.objects.select_related("userprofile", "stats").get(username=username)
        is_private = user.userprofile.is_private if user.userprofile else False
        if is_private and not is_own_profile:
            raise PublicProfileError("Profile not found", 404)

        if hasattr(user, "stats"):
            stats = user.stats
            if stats.anime_count == 0:
                from apps.users.models import UserAnimeList

                has_anime = UserAnimeList.objects.filter(user=user).exists()
                if has_anime:
                    logger.warning(
                        "UserStats for %s has anime_count=0 but user has anime entries — "
                        "falling through to live query",
                        username,
                    )
                    from apps.users.tasks import update_user_stats

                    update_user_stats.delay(user.id)
                    raise ValueError("Stale UserStats detected")

            data = {
                "id": user.id,
                "username": user.username,
                "date_joined": user.date_joined,
                "avatar": user.userprofile.avatar.url
                if user.userprofile and user.userprofile.avatar
                else None,
                "banner": user.userprofile.banner.url
                if user.userprofile and user.userprofile.banner
                else None,
                "bio": user.userprofile.bio if user.userprofile else None,
                "is_private": user.userprofile.is_private if user.userprofile else False,
                "social_links": user.userprofile.social_links if user.userprofile else [],
                "points": user.userprofile.points if user.userprofile else 0,
                "followers_count": stats.followers_count,
                "following_count": stats.following_count,
                "anime_count": stats.anime_count,
                "episodes_watched": stats.episodes_watched,
                "days_watched": stats.days_watched,
                "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
                "favorites_count": stats.favorites_count,
                "reviews_count": stats.reviews_count,
                "is_online": is_user_online(user),
            }

            if is_authenticated:
                from apps.users.models import UserFollow

                data["is_following"] = UserFollow.objects.filter(
                    follower=viewer, following=user
                ).exists()
            else:
                data["is_following"] = False

            badges, total_badges_count = get_featured_badges(user)
            data["badges"] = badges
            data["total_badges_count"] = total_badges_count

            cache.set(cache_key, data, timeout=300)
            return PublicProfileResult(data=data, cache_hit=False, source="stats")

    except User.DoesNotExist as exc:
        raise PublicProfileError("User not found", 404) from exc
    except PublicProfileError:
        raise
    except Exception as exc:
        logger.warning("Stats table lookup failed for %s: %s", username, exc)

    queryset = get_annotated_user_queryset(viewer if is_authenticated else None).filter(username=username)
    if not queryset.exists():
        raise PublicProfileError("User not found", 404)

    user = queryset.first()
    is_private = user.userprofile.is_private if user.userprofile else False
    if is_private and not is_own_profile:
        raise PublicProfileError("Profile not found", 404)

    serializer = PublicUserSerializer(user, context={"request": request} if request else None)
    data = serializer.data
    cache.set(cache_key, data, timeout=300)

    from apps.users.tasks import update_user_stats

    update_user_stats.delay(user.id)

    return PublicProfileResult(data=data, cache_hit=False, source="fallback")
