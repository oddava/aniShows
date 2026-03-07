"""Centralized cache key management to prevent invalidation bugs."""

from typing import List

class CacheKeys:
    """Namespace for all cache keys."""

    TRENDING_ANIME = "anime:trending"
    TOP_RATED = "anime:top_rated"
    ANIME_DETAIL = "anime:detail:{slug}"
    USER_RECOMMENDATIONS = "user:recs:{user_id}"
    USER_FAVORITES_COUNT = "user:fav_count:{user_id}"
    GENRE_LIST = "genres:all"
    STUDIO_LIST = "studios:all"

    @classmethod
    def anime_detail(cls, slug: str) -> str:
        return cls.ANIME_DETAIL.format(slug=slug)

    @classmethod
    def user_recommendations(cls, user_id: int) -> str:
        return cls.USER_RECOMMENDATIONS.format(user_id=user_id)

    @classmethod
    def user_favorites_count(cls, user_id: int) -> str:
        return cls.USER_FAVORITES_COUNT.format(user_id=user_id)

    @classmethod
    def invalidate_anime(cls, slug: str) -> List[str]:
        """Get all keys to invalidate when anime changes."""
        return [
            cls.TRENDING_ANIME,
            cls.TOP_RATED,
            cls.anime_detail(slug),
        ]

    @classmethod
    def invalidate_user(cls, user_id: int) -> List[str]:
        """Get all keys to invalidate when user data changes."""
        return [
            cls.user_recommendations(user_id),
            cls.user_favorites_count(user_id),
        ]

class CacheTTL:
    """TTL constants for different cache types (in seconds)."""

    TRENDING = 60 * 15  # 15 minutes
    TOP_RATED = 60 * 30  # 30 minutes
    ANIME_DETAIL = 60 * 60  # 1 hour
    USER_RECS = 60 * 60 * 2  # 2 hours
    STATIC_DATA = 60 * 60 * 24  # 24 hours (genres, studios)
    SHORT = 60 * 5  # 5 minutes
