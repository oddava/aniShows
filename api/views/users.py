from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.core.cache import cache
from django.db.models import Count, Avg, Sum, F, Q, Exists, OuterRef
from datetime import timedelta
import logging

from api.serializers import (
    UserSerializer,
    PublicUserSerializer,
    UserProfileUpdateSerializer,
)
from users.models import UserProfile

logger = logging.getLogger(__name__)
User = get_user_model()


def get_annotated_user_queryset(user=None):
    """Helper to get user queryset with all performance annotations."""
    from django.db.models import FloatField, Subquery, OuterRef
    from django.db.models.functions import Coalesce, Round
    from users.models import UserAnimeList

    queryset = User.objects.select_related("userprofile")

    # Annotate with counts to avoid N+1 queries
    queryset = queryset.annotate(
        _favorites_count=Count("favorites", distinct=True),
        _reviews_count=Count("reviews", distinct=True),
        _followers_count=Count("followers", distinct=True),
        _following_count=Count("following", distinct=True),
        _anime_count=Count("anime_lists", distinct=True),
    )

    # Calculate episodes watched using subquery to avoid join duplicates
    episodes_subquery = (
        UserAnimeList.objects.filter(user=OuterRef("pk"))
        .values("user")
        .annotate(total=Sum("episodes_watched"))
        .values("total")
    )

    queryset = queryset.annotate(
        _episodes_watched=Coalesce(Subquery(episodes_subquery), 0)
    )

    # Calculate total minutes watched using subquery to avoid join duplicates
    total_minutes_subquery = (
        UserAnimeList.objects.filter(user=OuterRef("pk"))
        .annotate(entry_minutes=F("episodes_watched") * F("anime__duration_minutes"))
        .values("user")
        .annotate(total=Sum("entry_minutes"))
        .values("total")
    )

    queryset = queryset.annotate(
        _total_minutes=Coalesce(Subquery(total_minutes_subquery), 0)
    )

    # Calculate mean score (exclude 0 scores) - round to 1 decimal place
    queryset = queryset.annotate(
        _mean_score_raw=Avg("anime_lists__score", filter=Q(anime_lists__score__gt=0))
    )

    # Calculate days watched from total minutes
    queryset = queryset.annotate(
        _days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0
    )

    # Annotate is_following if user is provided
    if user and user.is_authenticated:
        from users.models import UserFollow

        queryset = queryset.annotate(
            _is_following=Exists(
                UserFollow.objects.filter(follower=user, following=OuterRef("pk"))
            )
        )

    return queryset


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        # Get user with annotations
        user = get_annotated_user_queryset().get(pk=request.user.pk)
        serializer = UserSerializer(user, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        if serializer.is_valid():
            # Username Change Logic
            new_username = serializer.validated_data.get("username")
            if new_username and new_username != request.user.username:
                profile, created = UserProfile.objects.get_or_create(user=request.user)

                # Check for cooldown
                if profile.last_username_change:
                    elapsed = timezone.now() - profile.last_username_change
                    if elapsed < timedelta(days=14):
                        days_left = 14 - elapsed.days
                        return Response(
                            {
                                "username": f"You can change your username again in {days_left} days."
                            },
                            status=400,
                        )

                # Check availability (User model handles unique constraint but good to be explicit for API)
                if User.objects.filter(username=new_username).exists():
                    return Response(
                        {"username": "This username is already taken."},
                        status=400,
                    )

                request.user.username = new_username
                request.user.save()

                # Update timestamp
                profile.last_username_change = timezone.now()
                profile.save()

            # Update profile fields - only from validated_data (mass assignment protection)
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            if "avatar" in serializer.validated_data:
                profile.avatar = serializer.validated_data["avatar"]
            if "banner" in serializer.validated_data:
                profile.banner = serializer.validated_data["banner"]
            if "bio" in serializer.validated_data:
                profile.bio = serializer.validated_data["bio"]
            if "is_private" in serializer.validated_data:
                profile.is_private = serializer.validated_data["is_private"]

            # Social links
            if "social_links" in serializer.validated_data:
                profile.social_links = serializer.validated_data["social_links"]

            profile.save()

            # Invalidate public profile cache for all users (both authenticated and anonymous)
            username = request.user.username
            cache.delete(f"public_profile:{username}:anon")
            # We can't easily delete all authenticated user caches, but they will expire in 5 minutes
            # Alternatively, we could use a cache versioning approach or wildcard delete if Redis supports it

            # Get user with annotations after update
            user = get_annotated_user_queryset().get(pk=request.user.pk)
            return Response(UserSerializer(user, context={"request": request}).data)
        return Response(serializer.errors, status=400)


class UserStatsView(APIView):
    """Get user statistics for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from users.models import UserAnimeList

        user = request.user

        # Get counts
        favorites_count = user.favorites.count()
        reviews_count = user.reviews.count()
        anime_count = UserAnimeList.objects.filter(user=user).count()

        # Calculate episodes watched
        episodes_watched = (
            UserAnimeList.objects.filter(user=user).aggregate(
                total=Sum("episodes_watched")
            )["total"]
            or 0
        )

        # Calculate total minutes watched
        total_minutes = (
            UserAnimeList.objects.filter(user=user)
            .annotate(
                entry_minutes=F("episodes_watched") * F("anime__duration_minutes")
            )
            .aggregate(total=Sum("entry_minutes"))["total"]
            or 0
        )

        # Calculate mean score (excluding 0 scores)
        mean_score = UserAnimeList.objects.filter(user=user, score__gt=0).aggregate(
            avg=Avg("score")
        )["avg"]

        # Calculate days watched
        days_watched = total_minutes / 1440.0

        return Response(
            {
                "favorites_count": favorites_count,
                "reviews_count": reviews_count,
                "anime_count": anime_count,
                "episodes_watched": episodes_watched,
                "total_minutes": total_minutes,
                "days_watched": round(days_watched, 1),
                "mean_score": round(mean_score, 1) if mean_score else 0,
            }
        )


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = []
    lookup_field = "username"

    def get_queryset(self):
        return get_annotated_user_queryset(
            self.request.user if self.request.user.is_authenticated else None
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def retrieve(self, request, *args, **kwargs):
        """Override retrieve to use fast queryset first, then enrich with stats"""
        from django.db.models import Count

        # Get user with basic profile info only (fast query)
        username = self.kwargs.get(self.lookup_field)

        # Build cache key based on username and requesting user
        cache_key = f"public_profile:{username}:{request.user.id if request.user.is_authenticated else 'anon'}"

        # Try to get from cache first
        cached_data = cache.get(cache_key)
        if cached_data:
            return Response(cached_data)

        queryset = User.objects.select_related("userprofile").filter(username=username)

        if not queryset.exists():
            from rest_framework.exceptions import NotFound

            raise NotFound("User not found")

        user = queryset.first()

        # Add is_following annotation if user is authenticated
        if request.user.is_authenticated:
            from users.models import UserFollow

            is_following = UserFollow.objects.filter(
                follower=request.user, following=user
            ).exists()
            user._is_following = is_following

        serializer = self.get_serializer(user)
        data = serializer.data

        # Cache for 5 minutes (300 seconds)
        cache.set(cache_key, data, 300)

        return Response(data)
