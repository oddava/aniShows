from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta
import logging

from api.serializers import UserSerializer, UserProfileUpdateSerializer
from users.models import UserProfile

logger = logging.getLogger(__name__)
User = get_user_model()


class UserProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        serializer = UserSerializer(request.user, context={"request": request})
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

            # Update profile fields
            profile, created = UserProfile.objects.get_or_create(user=request.user)
            if "avatar" in serializer.validated_data:
                profile.avatar = serializer.validated_data["avatar"]
            if "banner" in serializer.validated_data:
                profile.banner = serializer.validated_data["banner"]
            if "bio" in serializer.validated_data:
                profile.bio = serializer.validated_data["bio"]
            if "is_private" in request.data:
                profile.is_private = request.data.get("is_private", False)

            # Social links
            if "social_links" in serializer.validated_data:
                profile.social_links = serializer.validated_data["social_links"]

            profile.save()

            return Response(
                UserSerializer(request.user, context={"request": request}).data
            )
        return Response(serializer.errors, status=400)


class PublicUserProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = UserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = []
    lookup_field = "username"

    def get_queryset(self):
        return User.objects.select_related("userprofile").all()
