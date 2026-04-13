from importlib import import_module

from .anime import (
    AnimeCompactSerializer,
    AnimeDetailSerializer,
    AnimeListSerializer,
    AnimeMinimalSerializer,
    AnimeShelfSerializer,
    AnimeWatchEpisodeSerializer,
    EpisodeRatingInputSerializer,
    EpisodeRatingSummarySerializer,
)
from .base import (
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
from .imports import (
    UserImportJobSerializer,
)
from .reviews import (
    ReviewReactionActionSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
    ReviewUserSerializer,
    ReviewVoteActionSerializer,
)

_SERIALIZER_EXPORTS = [
    "AnimeCharacterSerializer",
    "AnimeCompactSerializer",
    "AnimeDetailSerializer",
    "AnimeListSerializer",
    "AnimeMinimalSerializer",
    "AnimeShelfSerializer",
    "AnimeStaffSerializer",
    "AnimeWatchEpisodeSerializer",
    "CharacterAnimeRoleSerializer",
    "CharacterCompactSerializer",
    "CharacterDetailSerializer",
    "CharacterSerializer",
    "EpisodeRatingInputSerializer",
    "EpisodeRatingSummarySerializer",
    "GenreSerializer",
    "ReviewReactionActionSerializer",
    "ReviewReportCreateSerializer",
    "ReviewSerializer",
    "ReviewUserSerializer",
    "ReviewVoteActionSerializer",
    "StaffCompactSerializer",
    "StaffDetailSerializer",
    "StaffProductionCreditSerializer",
    "StaffSerializer",
    "StaffVoiceRoleAnimeSerializer",
    "StaffVoiceRoleCharacterSerializer",
    "StaffVoiceRoleSerializer",
    "StudioSerializer",
    "ThemeSongSerializer",
    "UserImportJobSerializer",
]
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

__all__ = [*_SERIALIZER_EXPORTS, *_USER_SERIALIZER_EXPORTS]


def __getattr__(name: str):
    if name in _USER_SERIALIZER_EXPORTS:
        module = import_module("apps.users.serializers.users")
        value = getattr(module, name)
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted([*globals().keys(), *_SERIALIZER_EXPORTS, *_USER_SERIALIZER_EXPORTS])
