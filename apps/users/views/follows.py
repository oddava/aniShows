"""
Views for handling user following/followers functionality.
"""

from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.contrib.auth import get_user_model
from django.db import models
from django.db.models import Count
from django.shortcuts import get_object_or_404
import logging

from apps.users.models import UserFollow, UserAnimeList
from apps.animes.models import Anime
from apps.animes.serializers import (
    FollowSerializer,
    UserFollowListSerializer,
    FriendWatchingSerializer,
)
from apps.users.services.cache import invalidate_user_caches

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

            # Invalidate cache for both users involved
            invalidate_user_caches(target_user.id, target_user.username)
            invalidate_user_caches(request.user.id, request.user.username)

            # Get both counts in a single query instead of two separate count() calls
            counts = User.objects.filter(pk__in=[target_user.pk, request.user.pk]).aggregate(
                target_followers=Count("followers", filter=models.Q(pk=target_user.pk)),
                user_following=Count("following", filter=models.Q(pk=request.user.pk)),
            )

            return Response(
                {
                    "status": "unfollowed",
                    "is_following": False,
                    "followers_count": counts["target_followers"],
                    "following_count": counts["user_following"],
                }
            )

        logger.info(f"{request.user.username} followed {target_user.username}")

        # Invalidate cache for both users involved
        invalidate_user_caches(target_user.id, target_user.username)
        invalidate_user_caches(request.user.id, request.user.username)

        # Get both counts in a single query instead of two separate count() calls
        counts = User.objects.filter(pk__in=[target_user.pk, request.user.pk]).aggregate(
            target_followers=Count("followers", filter=models.Q(pk=target_user.pk)),
            user_following=Count("following", filter=models.Q(pk=request.user.pk)),
        )

        return Response(
            {
                "status": "followed",
                "is_following": True,
                "followers_count": counts["target_followers"],
                "following_count": counts["user_following"],
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
        from django.db.models import Exists, OuterRef

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

        # Annotate is_following and is_follower to avoid N+1 queries
        if request.user.is_authenticated:
            queryset = queryset.annotate(
                _is_following=Exists(
                    UserFollow.objects.filter(follower=request.user, following=OuterRef("follower"))
                ),
                _is_follower=Exists(
                    UserFollow.objects.filter(follower=OuterRef("follower"), following=request.user)
                ),
            )

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
        """Get list of users this user is following"""
        from django.db.models import Exists, OuterRef

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

        # Annotate is_following and is_follower to avoid N+1 queries
        if request.user.is_authenticated:
            queryset = queryset.annotate(
                _is_following=Exists(
                    UserFollow.objects.filter(
                        follower=request.user, following=OuterRef("following")
                    )
                ),
                _is_follower=Exists(
                    UserFollow.objects.filter(
                        follower=OuterRef("following"), following=request.user
                    )
                ),
            )

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
        """Get list of a user's mutual follows (friends)"""
        from django.db.models import Exists, OuterRef

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

        # Find users where both directions of follow exist:
        # target_user follows them AND they follow target_user
        queryset = (
            UserFollow.objects.filter(
                follower=target_user,
                following__following__following=target_user,
            )
            .select_related("following__userprofile")
            .order_by("-created_at")
        )

        # Annotate is_following and is_follower relative to the requesting user
        if request.user.is_authenticated:
            queryset = queryset.annotate(
                _is_following=Exists(
                    UserFollow.objects.filter(
                        follower=request.user, following=OuterRef("following")
                    )
                ),
                _is_follower=Exists(
                    UserFollow.objects.filter(
                        follower=OuterRef("following"), following=request.user
                    )
                ),
            )

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
        """Check if current user is following a specific user"""
        target_user = get_object_or_404(User, username=username)

        is_following = UserFollow.objects.filter(
            follower=request.user, following=target_user
        ).exists()

        return Response({"is_following": is_following})

    @action(
        detail=False,
        methods=["GET"],
        url_path="friends/watching",
        permission_classes=[permissions.IsAuthenticated],
    )
    def friends_watching(self, request):
        """Get friends (mutual follows) who are watching a specific anime - optimized"""
        from django.db.models import Exists, OuterRef

        anime_id = request.query_params.get("anime_id")
        if not anime_id:
            return Response(
                {"detail": "anime_id parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify anime exists
        anime = get_object_or_404(Anime, id=anime_id)

        # Optimized: Find mutual follows in a single query using subqueries
        # Users who follow me AND who I follow back
        friends_watching = (
            UserAnimeList.objects.filter(
                anime=anime,
                # User must be someone I follow
                user__followers__follower=request.user,
                # User must also follow me back (mutual)
                user__following__following=request.user,
            )
            .select_related("user__userprofile", "anime")
            .order_by("-updated_at")[:50]  # Cap to prevent unbounded results
        )

        serializer = FriendWatchingSerializer(
            friends_watching, many=True, context={"request": request}
        )
        return Response(serializer.data)
