from collections.abc import Mapping

from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.viewsets import GenericViewSet

from ..models import UserBadge
from ..serializers.badges import UserBadgeSerializer
from ..services.badge_service import set_featured_badges


class CommunityActionRateThrottle(UserRateThrottle):
    scope = "community_action"


class UserBadgeViewSet(GenericViewSet):
    """User-facing API for managing featured badges."""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # ``IsAuthenticated`` guarantees a real user here.
        return UserBadge.objects.filter(user_id=self.request.user.pk).select_related("badge")

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Get all my badges (each with ``badge.is_active``)."""
        serializer = UserBadgeSerializer(self.get_queryset(), many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["put"], throttle_classes=[CommunityActionRateThrottle])
    def featured(self, request):
        """Replace the featured badges with ``badge_ids`` (user_badge ids, at most 3)."""
        if not isinstance(request.data, Mapping):
            raise ValidationError({"badge_ids": "Please provide a list of user_badge ids."})
        featured = set_featured_badges(request.user, request.data.get("badge_ids", []))
        return Response(
            {
                "detail": "Featured badges updated successfully.",
                "featured_badges": UserBadgeSerializer(featured, many=True).data,
            }
        )
