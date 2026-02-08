"""
Views for handling user following/followers functionality.
"""
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
import logging

from users.models import UserFollow, UserProfile
from api.serializers import FollowSerializer, UserFollowListSerializer

logger = logging.getLogger(__name__)
User = get_user_model()


class FollowPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class FollowViewSet(viewsets.GenericViewSet):
    """Handle follow/unfollow operations and listing followers/following"""

    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = FollowPagination

    @action(detail=False, methods=["POST"])
    def toggle(self, request):
        """Toggle follow status for a user"""
        if not request.user.is_authenticated:
            return Response(
                {"detail": "Authentication required."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = FollowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        username = serializer.validated_data["username"]
        target_user = get_object_or_404(User, username=username)

        if target_user == request.user:
            return Response(
                {"detail": "You cannot follow yourself."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        follow, created = UserFollow.objects.get_or_create(
            follower=request.user, following=target_user
        )

        if not created:
            follow.delete()
            logger.info(f"{request.user.username} unfollowed {target_user.username}")
            return Response(
                {
                    "status": "unfollowed",
                    "is_following": False,
                    "followers_count": target_user.followers.count(),
                }
            )

        logger.info(f"{request.user.username} followed {target_user.username}")
        return Response(
            {
                "status": "followed",
                "is_following": True,
                "followers_count": target_user.followers.count(),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=False,
        methods=["GET"],
        url_path="followers/(?P<username>[^/.]+)",
        permission_classes=[permissions.AllowAny],
    )
    def followers(self, request, username=None):
        """Get list of a user's followers"""
        target_user = get_object_or_404(User, username=username)

        # Check if profile is private
        profile = getattr(target_user, "userprofile", None)
        if (
            profile
            and profile.is_private
            and (not request.user.is_authenticated or target_user != request.user)
        ):
            return Response(
                {"detail": "This profile is private."},
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = UserFollow.objects.filter(following=target_user).select_related(
            "follower__userprofile"
        )

        # Annotate the user to display
        for follow in queryset:
            follow._display_user = follow.follower

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = UserFollowListSerializer(
                page, many=True, context={"request": request}
            )
            return self.get_paginated_response(serializer.data)

        serializer = UserFollowListSerializer(
            queryset, many=True, context={"request": request}
        )
        return Response(serializer.data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="following/(?P<username>[^/.]+)",
        permission_classes=[permissions.AllowAny],
    )
    def following(self, request, username=None):
        """Get list of users this user is following"""
        target_user = get_object_or_404(User, username=username)

        profile = getattr(target_user, "userprofile", None)
        if (
            profile
            and profile.is_private
            and (not request.user.is_authenticated or target_user != request.user)
        ):
            return Response(
                {"detail": "This profile is private."},
                status=status.HTTP_403_FORBIDDEN,
            )

        queryset = UserFollow.objects.filter(follower=target_user).select_related(
            "following__userprofile"
        )

        for follow in queryset:
            follow._display_user = follow.following

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = UserFollowListSerializer(
                page, many=True, context={"request": request}
            )
            return self.get_paginated_response(serializer.data)

        serializer = UserFollowListSerializer(
            queryset, many=True, context={"request": request}
        )
        return Response(serializer.data)

    @action(
        detail=False,
        methods=["GET"],
        url_path="check/(?P<username>[^/.]+)",
        permission_classes=[permissions.IsAuthenticated],
    )
    def check(self, request, username=None):
        """Check if current user is following a specific user"""
        target_user = get_object_or_404(User, username=username)

        is_following = UserFollow.objects.filter(
            follower=request.user, following=target_user
        ).exists()

        return Response({"is_following": is_following})
