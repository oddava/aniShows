from .anime import AnimeViewSet, GenreViewSet, StudioViewSet
from .characters import CharacterViewSet
from .favorites import CharacterFavoriteViewSet, FavoriteViewSet, StaffFavoriteViewSet
from .recommendations import RecommendationsViewSet
from .reviews import ReviewViewSet
from .staff import StaffViewSet

__all__ = [
    "AnimeViewSet",
    "CharacterFavoriteViewSet",
    "CharacterViewSet",
    "FavoriteViewSet",
    "GenreViewSet",
    "RecommendationsViewSet",
    "ReviewViewSet",
    "StaffFavoriteViewSet",
    "StaffViewSet",
    "StudioViewSet",
]
