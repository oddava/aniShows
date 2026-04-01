from importlib import import_module

from apps.animes.serializers.anime import (
    AnimeCompactSerializer,
    AnimeDetailSerializer,
    AnimeListSerializer,
    AnimeMinimalSerializer,
)
from apps.animes.serializers.base import (
    AnimeCharacterSerializer,
    AnimeStaffSerializer,
    CharacterAnimeRoleSerializer,
    CharacterCompactSerializer,
    CharacterDetailSerializer,
    CharacterSerializer,
    GenreSerializer,
    StaffCompactSerializer,
    StaffDetailSerializer,
    StaffProductionCreditSerializer,
    StaffSerializer,
    StaffVoiceRoleAnimeSerializer,
    StaffVoiceRoleCharacterSerializer,
    StaffVoiceRoleSerializer,
    StudioSerializer,
    ThemeSongSerializer,
)
from apps.animes.serializers.imports import (
    UserImportJobSerializer,
)
from apps.animes.serializers.reviews import (
    ReviewCommentSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
    ReviewUserSerializer,
)

_USER_SERIALIZER_EXPORTS = {
    "BadgeSerializer",
    "CharacterFavoriteSerializer",
    "ChangePasswordSerializer",
    "FavoriteCompactSerializer",
    "FavoriteSerializer",
    "FollowSerializer",
    "FriendWatchingSerializer",
    "PublicUserSerializer",
    "RegisterSerializer",
    "StaffFavoriteSerializer",
    "UserActivitySerializer",
    "UserAnimeListSerializer",
    "UserBadgeSerializer",
    "UserFollowListSerializer",
    "UserLightweightSerializer",
    "UserProfileUpdateSerializer",
    "UserRecommendationSerializer",
    "UserSerializer",
}


def __getattr__(name: str):
    if name in _USER_SERIALIZER_EXPORTS:
        module = import_module("apps.users.serializers.users")
        value = getattr(module, name)
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted([*globals().keys(), *_USER_SERIALIZER_EXPORTS])
