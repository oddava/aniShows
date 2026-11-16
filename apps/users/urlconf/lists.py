"""List routes (G3): list entries and activity."""

from ..views import UserActivityViewSet, UserAnimeListViewSet

router_routes = [
    (r"lists", UserAnimeListViewSet, "lists"),
    (r"activity", UserActivityViewSet, "activity"),
]

urlpatterns: list = []
