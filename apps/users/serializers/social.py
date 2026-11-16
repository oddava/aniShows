"""Follow and friends-watching serializers (G5 Community)."""

from rest_framework.serializers import (
    CharField,
    ModelSerializer,
    Serializer,
    SerializerMethodField,
)

from ..models import UserAnimeList
from ..services.avatar_service import get_user_avatar_url

__all__ = [
    "FollowSerializer",
    "FriendWatchingSerializer",
    "UserFollowListSerializer",
]


class FollowSerializer(Serializer):
    """Serializer for follow/unfollow actions"""

    username = CharField()


class UserFollowListSerializer(ModelSerializer):
    """Serializer for displaying followers/following lists"""

    user = SerializerMethodField()
    is_following = SerializerMethodField()
    is_follower = SerializerMethodField()

    class Meta:
        from ..models import UserFollow

        model = UserFollow
        fields = ["id", "user", "is_following", "is_follower", "created_at"]

    def get_user(self, obj):
        user_obj = getattr(obj, "_display_user", obj.follower)
        profile = getattr(user_obj, "userprofile", None)
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": get_user_avatar_url(user_obj),
            "points": profile.points if profile else 0,
        }

    def get_is_following(self, obj):
        """Check if the current user follows this user"""
        if hasattr(obj, "_is_following"):
            return obj._is_following
        return False

    def get_is_follower(self, obj):
        """Check if this user follows the current user"""
        if hasattr(obj, "_is_follower"):
            return obj._is_follower
        return False


class FriendWatchingSerializer(ModelSerializer):
    """Serializer for displaying friends watching a specific anime"""

    user = SerializerMethodField()
    anime = SerializerMethodField()

    class Meta:
        model = UserAnimeList
        fields = [
            "id",
            "user",
            "anime",
            "status",
            "score",
            "episodes_watched",
            "updated_at",
        ]

    def get_user(self, obj):
        """Return user details with avatar"""
        user_obj = obj.user
        return {
            "id": user_obj.id,
            "username": user_obj.username,
            "avatar": get_user_avatar_url(user_obj),
        }

    def get_anime(self, obj):
        """Return minimal anime info"""
        return {
            "id": obj.anime.id,
            "title": obj.anime.title,
            "episode_count": obj.anime.episode_count,
        }
