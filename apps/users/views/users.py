import time

from django.contrib.auth import get_user_model
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.shared.logger import logger
from apps.users import throttling
from apps.users.models import UserStats
from apps.users.serializers.users import (
    PublicUserSerializer,
    UserProfileUpdateSerializer,
)
from apps.users.services.profile_service import get_current_user_profile
from apps.users.services.profile_update_service import update_user_profile
from apps.users.services.public_profile_service import (
    PublicProfileError,
    get_public_profile,
)
from apps.users.services.user_queryset import get_annotated_user_queryset
from apps.users.services.user_stats_service import get_user_stats

User = get_user_model()


class UserProfileView(APIView):
    """
    Get/update current user profile.

    GET /users/me/ - Returns user profile (cached, fast)
    Supports 'full' query param for complete stats.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        start_time = time.time()
        user_id = request.user.id
        is_full = request.query_params.get("full", "false").lower() == "true"

        try:
            result = get_current_user_profile(user_id=user_id, is_full=is_full)
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)

        duration = (time.time() - start_time) * 1000
        if result.cache_hit:
            logger.debug(f"Profile cache hit for user {user_id}: {duration:.2f}ms")
        else:
            logger.info(f"Profile fetched for user {user_id}: {duration:.2f}ms")

        return Response(result.data)

    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        try:
            update_user_profile(
                request.user,
                serializer.validated_data,
                ip_address=request.META.get("REMOTE_ADDR"),
            )
        except ValidationError as exc:
            return Response(exc.detail, status=400)

        return self.get(request)


class UserStatsView(APIView):
    """Get detailed user statistics (separate endpoint for heavy calculations)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        result = get_user_stats(request.user)
        return Response(result.data)


class PublicUserProfileViewSet(ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [throttling.PublicUserProfileRateThrottle]
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
        """Optimized retrieve using pre-calculated stats table and caching."""
        start_time = time.time()
        username = self.kwargs.get(self.lookup_field)

        try:
            result = get_public_profile(username, request.user, request=request)
        except PublicProfileError as exc:
            return Response({"error": exc.message}, status=exc.status_code)

        duration = (time.time() - start_time) * 1000
        if result.cache_hit:
            logger.debug(f"Profile cache hit for {username}: {duration:.2f}ms")
        elif result.source == "stats":
            logger.info(f"Profile stats hit for {username}: {duration:.2f}ms")
        else:
            logger.warning(f"Profile fallback query for {username}: {duration:.2f}ms")

        return Response(result.data)
