"""Animes app URL configuration.
Anime-related API endpoints.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AnimeViewSet,
    CharacterFavoriteViewSet,
    CharacterViewSet,
    FavoriteViewSet,
    GenreViewSet,
    RecommendationsViewSet,
    ReviewViewSet,
    StaffFavoriteViewSet,
    StaffViewSet,
    StudioViewSet,
)

router = DefaultRouter()
router.register(r"anime", AnimeViewSet, basename="anime")
router.register(r"characters", CharacterViewSet, basename="characters")
router.register(r"genres", GenreViewSet)
router.register(r"studios", StudioViewSet)
router.register(r"staff", StaffViewSet, basename="staff")
router.register(r"favorites", FavoriteViewSet, basename="favorites")
router.register(r"character-favorites", CharacterFavoriteViewSet, basename="character-favorites")
router.register(r"staff-favorites", StaffFavoriteViewSet, basename="staff-favorites")
router.register(r"reviews", ReviewViewSet, basename="reviews")
router.register(r"recommendations", RecommendationsViewSet, basename="recommendations")

urlpatterns = [
    path("", include(router.urls)),
]
