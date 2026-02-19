"""
Animes app URL configuration.
Anime-related API endpoints.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AnimeViewSet,
    GenreViewSet,
    StudioViewSet,
    FavoriteViewSet,
    ReviewViewSet,
    RecommendationsViewSet,
)
from .views.image_views import ImageResizeView

router = DefaultRouter()
router.register(r"anime", AnimeViewSet, basename="anime")
router.register(r"genres", GenreViewSet)
router.register(r"studios", StudioViewSet)
router.register(r"favorites", FavoriteViewSet, basename="favorites")
router.register(r"reviews", ReviewViewSet, basename="reviews")
router.register(r"recommendations", RecommendationsViewSet, basename="recommendations")

urlpatterns = [
    path("", include(router.urls)),
    # Image optimization endpoints
    path(
        "media/resize/<path:filepath>", ImageResizeView.as_view(), name="image_resize"
    ),
]
