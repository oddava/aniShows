from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db.models import Exists, OuterRef

from ...shared.logger import logger
from ...shared.media_urls import normalize_media_url
from ...shared.public_cache import best_effort_get, best_effort_set
from ...shared.text import normalize_bio, normalize_primary_color
from ..serializers.accounts import PublicUserSerializer
from .avatar_service import get_user_avatar_url
from .cache import get_public_profile_cache_key
from .profile_service import build_profile_user_queryset, get_featured_badges, with_live_list_stats
from .user_queryset import filter_username_ci, get_annotated_user_queryset

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
    result = _get_public_profile(username, viewer, request)
    return PublicProfileResult(
        data=with_live_list_stats(result.data), cache_hit=result.cache_hit, source=result.source
    )


def _get_public_profile(username: str, viewer=None, request=None) -> PublicProfileResult:
    is_authenticated = viewer is not None and getattr(viewer, "is_authenticated", False)
    is_own_profile = is_authenticated and viewer.username.lower() == username.lower()
    viewer_id = viewer.id if is_authenticated else "anonymous"

    cache_key = get_public_profile_cache_key(username, viewer_id)
    cached_data = best_effort_get(cache_key, source="public profile")
    if cached_data:
        normalized = _normalize_public_profile_payload(cached_data)
        if normalized != cached_data:
            best_effort_set(cache_key, normalized, 300, source="public profile")
        cached_data = normalized
        if cached_data.get("is_private") and not is_own_profile:
            raise PublicProfileError("Profile not found", 404)
        return PublicProfileResult(data=cached_data, cache_hit=True, source="cache")

    try:
        stats_queryset = build_profile_user_queryset(include_badges=False)
        if is_authenticated:
            from ..models import UserFollow

            stats_queryset = stats_queryset.annotate(
                _is_following=Exists(
                    UserFollow.objects.filter(follower=viewer, following=OuterRef("pk"))
                )
            )
        user = filter_username_ci(stats_queryset, username).get()
        is_private = user.userprofile.is_private if user.userprofile else False
        if is_private and not is_own_profile:
            raise PublicProfileError("Profile not found", 404)

        if hasattr(user, "stats"):
            stats = user.stats
            if stats.anime_count == 0:
                from ..models import UserAnimeList

                has_anime = UserAnimeList.objects.filter(user=user).exists()
                if has_anime:
                    logger.warning(
                        "UserStats for %s has anime_count=0 but user has anime entries — "
                        "falling through to live query",
                        username,
                    )
                    from ..tasks import request_user_stats_refresh

                    request_user_stats_refresh(user.id)
                    raise ValueError("Stale UserStats detected")

            data = {
                "id": user.id,
                "username": user.username,
                "date_joined": user.date_joined,
                "avatar": get_user_avatar_url(user),
                "banner": normalize_media_url(user.userprofile.banner.url)
                if user.userprofile and user.userprofile.banner
                else None,
                "bio": normalize_bio(user.userprofile.bio if user.userprofile else None),
                "is_private": user.userprofile.is_private if user.userprofile else False,
                "social_links": user.userprofile.social_links if user.userprofile else [],
                "profile_primary_color": normalize_primary_color(
                    user.userprofile.profile_primary_color if user.userprofile else None
                ),
                "points": user.userprofile.points if user.userprofile else 0,
                "followers_count": stats.followers_count,
                "following_count": stats.following_count,
                "anime_count": stats.anime_count,
                "episodes_watched": stats.episodes_watched,
                "days_watched": stats.days_watched,
                "mean_score": round(stats.mean_score, 1) if stats.mean_score else None,
                "favorites_count": stats.favorites_count,
                "reviews_count": stats.reviews_count,
                "resonance_count": stats.resonance_count,
            }

            data["is_following"] = bool(getattr(user, "_is_following", False))

            badges, total_badges_count = get_featured_badges(user)
            data["badges"] = badges
            data["total_badges_count"] = total_badges_count

            data = _normalize_public_profile_payload(data)
            best_effort_set(cache_key, data, 300, source="public profile")
            return PublicProfileResult(data=data, cache_hit=False, source="stats")

    except User.DoesNotExist as exc:
        raise PublicProfileError("User not found", 404) from exc
    except PublicProfileError:
        raise
    except Exception as exc:
        logger.warning("Stats table lookup failed for %s: %s", username, exc, exc_info=True)

    queryset = filter_username_ci(
        get_annotated_user_queryset(viewer if is_authenticated else None), username
    )
    user = queryset.first()
    if user is None:
        raise PublicProfileError("User not found", 404)
    is_private = user.userprofile.is_private if user.userprofile else False
    if is_private and not is_own_profile:
        raise PublicProfileError("Profile not found", 404)

    serializer = PublicUserSerializer(user, context={"request": request} if request else None)
    data = _normalize_public_profile_payload(serializer.data)
    best_effort_set(cache_key, data, 300, source="public profile")

    from ..tasks import request_user_stats_refresh

    request_user_stats_refresh(user.id)

    return PublicProfileResult(data=data, cache_hit=False, source="fallback")


def _normalize_public_profile_payload(data):
    if not isinstance(data, dict):
        return data
    normalized = dict(data)
    normalized["bio"] = normalize_bio(normalized.get("bio"))
    normalized["profile_primary_color"] = normalize_primary_color(
        normalized.get("profile_primary_color")
    )
    return normalized
