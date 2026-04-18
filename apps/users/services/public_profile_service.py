import re
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Exists, OuterRef

from ...shared.logger import logger
from ...shared.media_urls import normalize_media_url
from ..serializers.users import PublicUserSerializer
from .avatar_service import get_user_avatar_url
from .cache import get_public_profile_cache_key
from .profile_service import build_profile_user_queryset, get_featured_badges
from .user_queryset import get_annotated_user_queryset

User = get_user_model()
DEFAULT_PROFILE_PRIMARY_COLOR = "#8b5cf6"
HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _decode_escaped_html_entities(value: str) -> str:
    return (
        value.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&amp;", "&")
    )


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
        normalized = _normalize_public_profile_payload(cached_data)
        if normalized != cached_data:
            cache.set(cache_key, normalized, timeout=300)
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
        user = stats_queryset.get(username=username)
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
                    from ..tasks import schedule_user_stats_refresh

                    schedule_user_stats_refresh(user_id=user.id)
                    raise ValueError("Stale UserStats detected")

            data = {
                "id": user.id,
                "username": user.username,
                "date_joined": user.date_joined,
                "avatar": get_user_avatar_url(user),
                "banner": normalize_media_url(user.userprofile.banner.url)
                if user.userprofile and user.userprofile.banner
                else None,
                "bio": _normalize_bio(user.userprofile.bio if user.userprofile else None),
                "is_private": user.userprofile.is_private if user.userprofile else False,
                "social_links": user.userprofile.social_links if user.userprofile else [],
                "profile_primary_color": _normalize_profile_primary_color(
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
            cache.set(cache_key, data, timeout=300)
            return PublicProfileResult(data=data, cache_hit=False, source="stats")

    except User.DoesNotExist as exc:
        raise PublicProfileError("User not found", 404) from exc
    except PublicProfileError:
        raise
    except Exception as exc:
        logger.warning("Stats table lookup failed for %s: %s", username, exc)

    queryset = get_annotated_user_queryset(viewer if is_authenticated else None).filter(
        username=username
    )
    user = queryset.first()
    if user is None:
        raise PublicProfileError("User not found", 404)
    is_private = user.userprofile.is_private if user.userprofile else False
    if is_private and not is_own_profile:
        raise PublicProfileError("Profile not found", 404)

    serializer = PublicUserSerializer(user, context={"request": request} if request else None)
    data = _normalize_public_profile_payload(serializer.data)
    cache.set(cache_key, data, timeout=300)

    from ..tasks import schedule_user_stats_refresh

    schedule_user_stats_refresh(user_id=user.id)

    return PublicProfileResult(data=data, cache_hit=False, source="fallback")


def _normalize_bio(value):
    if isinstance(value, str):
        return _decode_escaped_html_entities(value)
    return value


def _normalize_public_profile_payload(data):
    if not isinstance(data, dict):
        return data
    normalized = dict(data)
    normalized["bio"] = _normalize_bio(normalized.get("bio"))
    normalized["profile_primary_color"] = _normalize_profile_primary_color(
        normalized.get("profile_primary_color")
    )
    return normalized


def _normalize_profile_primary_color(value):
    if isinstance(value, str):
        candidate = value.strip().lower()
        if HEX_COLOR_PATTERN.match(candidate):
            return candidate
    return DEFAULT_PROFILE_PRIMARY_COLOR
