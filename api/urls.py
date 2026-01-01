from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AnimeViewSet, GenreViewSet, StudioViewSet,
    CustomTokenObtainPairView, RegisterView, UserProfileView,
    FavoriteViewSet, UserAnimeListViewSet, ReviewViewSet,
    VerifyEmailView, ResendVerificationView, PasswordResetView, PasswordResetConfirmView,
    ChangePasswordView, PublicUserProfileViewSet,
    DeleteAccountView, ChangeEmailView, ConfirmEmailChangeView
)
from .admin_views import (
    AdminDashboardView, AdminUserViewSet, AdminAnimeViewSet,
    AdminReviewViewSet, AdminStatsExportView
)
from users.views import GoogleLogin

router = DefaultRouter()
router.register(r'anime', AnimeViewSet, basename='anime')
router.register(r'genres', GenreViewSet)
router.register(r'studios', StudioViewSet)
router.register(r'favorites', FavoriteViewSet, basename='favorites')
router.register(r'lists', UserAnimeListViewSet, basename='lists')
router.register(r'reviews', ReviewViewSet, basename='reviews')
router.register(r'users', PublicUserProfileViewSet, basename='users')

# Admin router
admin_router = DefaultRouter()
admin_router.register(r'users', AdminUserViewSet, basename='admin-users')
admin_router.register(r'anime', AdminAnimeViewSet, basename='admin-anime')
admin_router.register(r'reviews', AdminReviewViewSet, basename='admin-reviews')

urlpatterns = [
    path('users/me/', UserProfileView.as_view(), name='user_profile'),
    path('', include(router.urls)),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/verify-email/', VerifyEmailView.as_view(), name='verify_email'),
    path('auth/resend-verification/', ResendVerificationView.as_view(), name='resend_verification'),
    path('auth/password-reset/', PasswordResetView.as_view(), name='password_reset'),
    path('auth/password-reset-confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('auth/change-password/', ChangePasswordView.as_view(), name='change_password'),
    path('auth/delete-account/', DeleteAccountView.as_view(), name='delete_account'),
    path('auth/change-email/', ChangeEmailView.as_view(), name='change_email'),
    path('auth/confirm-email-change/', ConfirmEmailChangeView.as_view(), name='confirm_email_change'),
    path('auth/google/', GoogleLogin.as_view(), name='google_login'),
    # Admin endpoints
    path('admin/', include(admin_router.urls)),
    path('admin/dashboard/', AdminDashboardView.as_view(), name='admin-dashboard'),
    path('admin/stats/export/', AdminStatsExportView.as_view(), name='admin-stats-export'),
]

