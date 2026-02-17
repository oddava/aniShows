# Re-export for backwards compatibility during migration
from .anime import AnimeViewSet, GenreViewSet, StudioViewSet
from .auth import CustomTokenObtainPairView, RegisterView
from .auth import (
    VerifyEmailView,
    ResendVerificationView,
    PasswordResetView,
    PasswordResetConfirmView,
)
from .users import UserProfileView, UserStatsView, PublicUserProfileViewSet
from .favorites import FavoriteViewSet
from .lists import UserAnimeListViewSet
from .reviews import ReviewViewSet
from .recommendations import RecommendationsViewSet
from .follows import FollowViewSet
from .account_management import (
    DeleteAccountView,
    ChangeEmailView,
    ConfirmEmailChangeView,
    ChangePasswordView,
)
from .health import health_check
