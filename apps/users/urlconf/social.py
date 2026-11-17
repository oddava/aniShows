"""Community routes in the users app (G5): follows and the user's badges."""

from ..views import FollowViewSet, UserBadgeViewSet

router_routes = [
    (r"follows", FollowViewSet, "follows"),
    (r"badges", UserBadgeViewSet, "user-badges"),
]

urlpatterns: list = []
