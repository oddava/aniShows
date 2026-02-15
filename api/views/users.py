from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
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
    queryset = User.objects.select_related("userprofile")

    # Annotate with counts to avoid N+1 queries
    queryset = queryset.annotate(
        _favorites_count=Count("favorites", distinct=True),
        _reviews_count=Count("reviews", distinct=True),
        _followers_count=Count("followers", distinct=True),
        _following_count=Count("following", distinct=True),
        _anime_count=Count("anime_lists", distinct=True),
        _episodes_watched=Sum("anime_lists__episodes_watched"),
    )

    # Calculate total minutes watched
    queryset = queryset.annotate(
        _total_minutes=Sum(
            F("anime_lists__episodes_watched")
            * F("anime_lists__anime__duration_minutes")
        )
    )

    # Calculate mean score (exclude 0 scores)
    queryset = queryset.annotate(
        _mean_score=Avg("anime_lists__score", filter=Q(anime_lists__score__gt=0))
    )

    # Calculate days watched from total minutes
    from django.db.models import FloatField
    from django.db.models.functions import Coalesce

    queryset = queryset.annotate(
        _days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0
    )

    # Annotate is_following if user is provided
    if user and user.is_authenticated:
        queryset = queryset.annotate(
            _is_following=Exists(
                UserProfile.objects.filter(user=user, following=OuterRef("pk"))
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

            # Get user with annotations after update
            user = get_annotated_user_queryset().get(pk=request.user.pk)
            return Response(UserSerializer(user, context={"request": request}).data)
        return Response(serializer.errors, status=400)


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = []
    lookup_field = "username"

    def get_queryset(self):
        return get_annotated_user_queryset(self.request)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context
