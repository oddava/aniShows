from allauth.socialaccount.models import SocialAccount
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.users.models import UserFollow
from apps.users.serializers.users import (
    FollowSerializer,
    FriendWatchingSerializer,
    UserFollowListSerializer,
)
from apps.users.services.follow_service import (
    get_followers_queryset,
    get_following_queryset,
    get_friends_watching_queryset,
    get_mutuals_queryset,
    is_following,
    toggle_follow,
)

class FollowViewSet(GenericViewSet):
    """Handle follow/unfollow operations and listing followers/following"""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    @action(detail=False, methods=["POST"])
    def toggle(self, request):
        serializer = FollowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_follow(request.user, serializer.validated_data["username"])
        return Response(result.payload, status=result.status_code)

    @action(
        detail=False,
        methods=["GET"],
        url_path="followers/(?P<username>[^/.]+)",
        permission_classes=[permissions.AllowAny],
    )
    def followers(self, request, username=None):
        queryset = get_followers_queryset(username, request.user)

        # Paginate FIRST, then set _display_user only on the page
        # (avoids evaluating the entire queryset just to set an attribute)
        page = self.paginate_queryset(queryset)
        if page is not None:
            for follow in page:
                follow._display_user = follow.follower
            serializer = UserFollowListSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)

        # Fallback for non-paginated response
        results = list(queryset)
        for follow in results:
            follow._display_user = follow.follower
        serializer = UserFollowListSerializer(results, many=True, context={"request": request})
        return Response(serializer.data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="following/(?P<username>[^/.]+)",
        permission_classes=[permissions.AllowAny],
    )
    def following(self, request, username=None):
        queryset = get_following_queryset(username, request.user)

        # Paginate FIRST, then set _display_user only on the page
        page = self.paginate_queryset(queryset)
        if page is not None:
            for follow in page:
                follow._display_user = follow.following
            serializer = UserFollowListSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)

        results = list(queryset)
        for follow in results:
            follow._display_user = follow.following
        serializer = UserFollowListSerializer(results, many=True, context={"request": request})
        return Response(serializer.data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="mutuals/(?P<username>[^/.]+)",
        permission_classes=[permissions.AllowAny],
    )
    def mutuals(self, request, username=None):
        queryset = get_mutuals_queryset(username, request.user)

        # Paginate FIRST, then set _display_user only on the page
        page = self.paginate_queryset(queryset)
        if page is not None:
            for follow in page:
                follow._display_user = follow.following
            serializer = UserFollowListSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)

        results = list(queryset)
        for follow in results:
            follow._display_user = follow.following
        serializer = UserFollowListSerializer(results, many=True, context={"request": request})
        return Response(serializer.data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="check/(?P<username>[^/.]+)",
        permission_classes=[permissions.IsAuthenticated],
    )
    def check(self, request, username=None):
        return Response({"is_following": is_following(request.user, username)})

    @action(
        detail=False,
        methods=["GET"],
        url_path="friends/watching",
        permission_classes=[permissions.IsAuthenticated],
    )
    def friends_watching(self, request):
        friends_watching = get_friends_watching_queryset(
            request.user,
            request.query_params.get("anime_id"),
        )
        serializer = FriendWatchingSerializer(
            friends_watching, many=True, context={"request": request}
        )
        return Response(serializer.data)
