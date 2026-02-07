# Re-export for backwards compatibility during migration
from .anime import AnimeViewSet, GenreViewSet, StudioViewSet
from .auth import CustomTokenObtainPairView, RegisterView
from .auth import (
    VerifyEmailView,
    ResendVerificationView,
    PasswordResetView,
    PasswordResetConfirmView,
)
from .users import UserProfileView, PublicUserProfileViewSet
from .favorites import FavoriteViewSet
from .lists import UserAnimeListViewSet
from .reviews import ReviewViewSet
from .recommendations import RecommendationsViewSet
from .account_management import (
    DeleteAccountView,
    ChangeEmailView,
    ConfirmEmailChangeView,
    ChangePasswordView,
)
