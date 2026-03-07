from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.users.models import UserBadge
from apps.animes.serializers import UserBadgeSerializer

class UserBadgeViewSet(GenericViewSet):
    """User-facing API for managing featured badges."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return UserBadge.objects.filter(user=self.request.user).select_related("badge")

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Get all my badges."""
        user_badges = self.get_queryset()
        serializer = UserBadgeSerializer(user_badges, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["put"])
    def featured(self, request):
        """Update featured badges (max 3)."""
        badge_ids = request.data.get("badge_ids", [])

        if not isinstance(badge_ids, list):
            return Response(
                {"detail": "Please provide a list of user_badge ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(badge_ids) > 3:
            return Response(
                {"detail": "You can feature a maximum of 3 badges."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify ownership of all badges being featured
        owned_badges = self.get_queryset().filter(id__in=badge_ids)
        if owned_badges.count() != len(badge_ids):
            return Response(
                {"detail": "You can only feature badges you own."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reset all featured
        self.get_queryset().update(is_featured=False)

        # Set new featured
        if badge_ids:
            self.get_queryset().filter(id__in=badge_ids).update(is_featured=True)

        # Invalidate user cache so profile shows updated badges
        from apps.users.services.cache import invalidate_user_caches

        invalidate_user_caches(request.user.id, request.user.username, trigger_stats_update=False)

        # Return updated list
        updated = self.get_queryset().filter(is_featured=True)
        serializer = UserBadgeSerializer(updated, many=True)
        return Response(
            {"detail": "Featured badges updated successfully.", "featured_badges": serializer.data}
        )
