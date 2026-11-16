import time

from botocore.exceptions import EndpointConnectionError
from django.contrib.auth import get_user_model
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ReadOnlyModelViewSet

from ...core.api_errors import error_response
from ...shared.logger import logger
from .. import throttling
from ..models import UserProfile
from ..serializers.accounts import (
    PublicUserSerializer,
    UserProfileUpdateSerializer,
)
from ..services.profile_service import get_current_user_profile
from ..services.profile_update_service import social_links_unchanged, update_user_profile
from ..services.public_profile_service import (
    PublicProfileError,
    get_public_profile,
)
from ..services.user_queryset import get_annotated_user_queryset
from ..services.user_stats_service import get_user_stats

User = get_user_model()


class UserProfileView(APIView):
    """
    Get/update current user profile.

    GET /users/me/ - Returns user profile (cached, fast). A ``full`` query
    parameter is accepted for old clients and ignored: there is one payload.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _profile_patch_data(self, request):
        """The PATCH body, minus ``social_links`` when they equal the stored ones.

        Settings re-sends unchanged links on every save; validating them again
        would re-run DNS/WHOIS checks and burn the 5/day social-links throttle,
        so that throttle applies only when the links really change (A03).
        """
        data = request.data
        if "social_links" not in data:
            return data
        # Read fresh: request.user may carry a profile cached before this request.
        stored_links = (
            UserProfile.objects.filter(user_id=request.user.pk)
            .values_list("social_links", flat=True)
            .first()
        )
        if social_links_unchanged(stored_links, data.get("social_links")):
            return {key: data[key] for key in data if key != "social_links"}

        throttle = throttling.SocialLinksRateThrottle()
        if not throttle.allow_request(request, self):
            raise Throttled(wait=throttle.wait())
        return data

    def get(self, request):
        start_time = time.time()
        user_id = request.user.id
        try:
            result = get_current_user_profile(user_id=user_id)
        except User.DoesNotExist:
            return error_response("User not found", code="user_not_found", status_code=404)

        duration = (time.time() - start_time) * 1000
        if result.cache_hit:
            logger.debug(f"Profile cache hit for user {user_id}: {duration:.2f}ms")
        else:
            logger.info(f"Profile fetched for user {user_id}: {duration:.2f}ms")

        return Response(result.data)

    def patch(self, request):
        logger.info(
            "Profile patch request received for user %s",
            request.user.id,
            extra={
                "user_id": request.user.id,
                "raw_profile_primary_color": request.data.get("profile_primary_color"),
                "request_keys": sorted(request.data.keys()),
            },
        )
        serializer = UserProfileUpdateSerializer(
            data=self._profile_patch_data(request), context={"request": request}
        )
        serializer.is_valid(raise_exception=True)

        logger.info(
            "Profile patch validated for user %s",
            request.user.id,
            extra={
                "user_id": request.user.id,
                "validated_profile_primary_color": serializer.validated_data.get(
                    "profile_primary_color"
                ),
                "validated_keys": sorted(serializer.validated_data.keys()),
            },
        )

        try:
            update_user_profile(
                request.user,
                serializer.validated_data,
                ip_address=request.META.get("REMOTE_ADDR"),
            )
        except EndpointConnectionError as exc:
            logger.warning(
                "Media storage unavailable during profile update for user %s: %s",
                request.user.id,
                exc,
            )
            return Response(
                {"detail": ("Media storage is temporarily unavailable. Please try again shortly.")},
                status=503,
            )
        except ValidationError:
            raise

        return self.get(request)


class UserStatsView(APIView):
    """Get detailed user statistics (separate endpoint for heavy calculations)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        result = get_user_stats(request.user)
        return Response(result.data)


class PublicUserProfileViewSet(ReadOnlyModelViewSet):
    """Public profile view by username"""

    serializer_class = PublicUserSerializer
    permission_classes = [AllowAny]
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
            return error_response(
                exc.message,
                code="public_profile_unavailable",
                status_code=exc.status_code,
            )

        duration = (time.time() - start_time) * 1000
        if result.cache_hit:
            logger.debug(f"Profile cache hit for {username}: {duration:.2f}ms")
        elif result.source == "stats":
            logger.info(f"Profile stats hit for {username}: {duration:.2f}ms")
        else:
            logger.warning(f"Profile fallback query for {username}: {duration:.2f}ms")

        return Response(result.data)
