from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from ...core.api_errors import api_response
from ...shared.throttling import ResilientUserRateThrottle
from ..permissions import VerifiedEmailForWrites
from ..serializers.social import (
    FollowSerializer,
    FriendWatchingSerializer,
    UserFollowListSerializer,
)
from ..services.follow_service import (
    get_followers_queryset,
    get_following_queryset,
    get_friends_watching,
    get_mutuals_queryset,
    is_following,
    toggle_follow,
)


class FollowToggleRateThrottle(ResilientUserRateThrottle):
    scope = "follow_toggle"


FRIENDS_WATCHING_TOTAL_HEADER = "X-Total-Count"


class FollowViewSet(GenericViewSet):
    """Handle follow/unfollow operations and listing followers/following"""

    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    @action(detail=False, methods=["POST"], throttle_classes=[FollowToggleRateThrottle])
    def toggle(self, request):
        serializer = FollowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_follow(request.user, serializer.validated_data["username"])
        return api_response(result.payload, status_code=result.status_code)

    def _list_users(self, queryset, user_field: str) -> Response:
        """Paginate follow rows and show the user on ``user_field`` of each."""
        # Paginate first, then set _display_user only on the page.
        page = self.paginate_queryset(queryset)
        rows = list(queryset) if page is None else page
        for follow in rows:
            follow._display_user = getattr(follow, user_field)
        data = UserFollowListSerializer(rows, many=True, context={"request": self.request}).data
        return Response(data) if page is None else self.get_paginated_response(data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="followers/(?P<username>[^/]+)",
        permission_classes=[AllowAny],
    )
    def followers(self, request, username=None):
        queryset = get_followers_queryset(
            username, request.user, search=request.query_params.get("search")
        )
        return self._list_users(queryset, "follower")

    @action(
        detail=False,
        methods=["GET"],
        url_path="following/(?P<username>[^/]+)",
        permission_classes=[AllowAny],
    )
    def following(self, request, username=None):
        queryset = get_following_queryset(
            username, request.user, search=request.query_params.get("search")
        )
        return self._list_users(queryset, "following")

    @action(
        detail=False,
        methods=["GET"],
        url_path="mutuals/(?P<username>[^/]+)",
        permission_classes=[AllowAny],
    )
    def mutuals(self, request, username=None):
        queryset = get_mutuals_queryset(
            username, request.user, search=request.query_params.get("search")
        )
        return self._list_users(queryset, "following")

    @action(
        detail=False,
        methods=["GET"],
        url_path="check/(?P<username>[^/]+)",
        permission_classes=[IsAuthenticated],
    )
    def check(self, request, username=None):
        return Response({"is_following": is_following(request.user, username)})

    @action(
        detail=False,
        methods=["GET"],
        url_path="friends/watching",
        permission_classes=[IsAuthenticated],
    )
    def friends_watching(self, request):
        friends = get_friends_watching(request.user, request.query_params.get("anime_id"))
        serializer = FriendWatchingSerializer(
            friends.results, many=True, context={"request": request}
        )
        # The body stays a plain list (its shape is a published contract); the
        # uncapped total for "+N more" rides in a header.
        return Response(
            serializer.data, headers={FRIENDS_WATCHING_TOTAL_HEADER: str(friends.total)}
        )
