from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AnimeViewSet, GenreViewSet, StudioViewSet,
    CustomTokenObtainPairView, RegisterView, UserProfileView,
    FavoriteViewSet, UserAnimeListViewSet, ReviewViewSet,
    VerifyEmailView, PasswordResetView, PasswordResetConfirmView
)

router = DefaultRouter()
router.register(r'anime', AnimeViewSet, basename='anime')
router.register(r'genres', GenreViewSet)
router.register(r'studios', StudioViewSet)
router.register(r'favorites', FavoriteViewSet, basename='favorites')
router.register(r'lists', UserAnimeListViewSet, basename='lists')
router.register(r'reviews', ReviewViewSet, basename='reviews')

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/verify-email/', VerifyEmailView.as_view(), name='verify_email'),
    path('auth/password-reset/', PasswordResetView.as_view(), name='password_reset'),
    path('auth/password-reset-confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('users/me/', UserProfileView.as_view(), name='user_profile'),
]
