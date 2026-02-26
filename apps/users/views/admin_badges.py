import logging

from django.contrib.auth import get_user_model
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils.text import slugify

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

logger = logging.getLogger(__name__)

from apps.users.models import Badge, UserBadge
from apps.animes.serializers import BadgeSerializer
from apps.core.permissions import IsAdminUser, AdminPagination
from apps.core.models import AuditLog
from apps.core.services.notification_service import NotificationService

User = get_user_model()


class AdminBadgeViewSet(viewsets.ModelViewSet):
    """Admin CRUD operations for Badges."""

    permission_classes = [IsAdminUser]
    serializer_class = BadgeSerializer
    pagination_class = AdminPagination
    queryset = Badge.objects.annotate(holders_count=Count("user_badges")).order_by(
        "-priority", "name"
    )

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        # Search
        search = request.query_params.get("search", "")
        if search:
            queryset = queryset.filter(name__icontains=search)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            # Add holders_count
            for data, obj in zip(serializer.data, page):
                data["holders_count"] = obj.holders_count
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except Exception as e:
            logger.error(f"Error creating badge: {str(e)}")
            return Response(
                {"detail": f"Failed to create badge: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

        AuditLog.objects.create(
            user=self.request.user,
            user_ip=self.request.META.get("REMOTE_ADDR"),
            action=AuditLog.ActionType.CREATE,
            entity_type="Badge",
            entity_id=str(serializer.instance.id),
            entity_repr=serializer.instance.name,
            metadata={"name": serializer.instance.name},
        )

    def perform_destroy(self, instance):
        AuditLog.objects.create(
            user=self.request.user,
            user_ip=self.request.META.get("REMOTE_ADDR"),
            action=AuditLog.ActionType.DELETE,
            entity_type="Badge",
            entity_id=str(instance.id),
            entity_repr=instance.name,
            metadata={"name": instance.name},
        )
        instance.delete()

    @action(detail=True, methods=["post"])
    def grant(self, request, pk=None):
        """Grant a badge to multiple users."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can grant badges."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            badge = self.get_object()
            user_ids = request.data.get("user_ids", [])
            reason = request.data.get("reason", "")

            if not user_ids or not isinstance(user_ids, list):
                return Response(
                    {"detail": "Please provide a list of user_ids."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            users = User.objects.filter(id__in=user_ids)
            granted_count = 0

            for user in users:
                # Skip if user already has this badge
                if UserBadge.objects.filter(user=user, badge=badge).exists():
                    continue

                UserBadge.objects.create(
                    user=user, badge=badge, granted_by=request.user, reason=reason
                )
                granted_count += 1

                # Send notification (gracefully handle if notification type doesn't exist yet)
                try:
                    NotificationService.create_badge_awarded_notification(
                        user=user, badge=badge, granted_by=request.user
                    )
                except Exception as notify_error:
                    logger.warning(f"Could not send badge notification: {notify_error}")

            AuditLog.objects.create(
                user=request.user,
                user_ip=request.META.get("REMOTE_ADDR"),
                action=AuditLog.ActionType.BULK_ACTION,
                entity_type="UserBadge",
                entity_repr=f"Grant {badge.name} to {granted_count} users",
                metadata={
                    "action": "grant",
                    "badge_id": badge.id,
                    "badge_name": badge.name,
                    "users_granted": granted_count,
                    "total_requested": len(user_ids),
                },
            )

            # Invalidate user caches for all affected users
            from apps.users.services.cache import invalidate_user_caches

            for user in users:
                invalidate_user_caches(user.id, user.username, trigger_stats_update=False)

            return Response({"message": f"Badge granted to {granted_count} users successfully."})
        except Exception as e:
            logger.error(f"Error granting badge: {str(e)}")
            return Response(
                {"detail": f"Failed to grant badge: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        """Revoke a badge from multiple users."""
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only superusers can revoke badges."},
                status=status.HTTP_403_FORBIDDEN,
            )

        badge = self.get_object()
        user_ids = request.data.get("user_ids", [])

        if not user_ids or not isinstance(user_ids, list):
            return Response(
                {"detail": "Please provide a list of user_ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted_count, _ = UserBadge.objects.filter(badge=badge, user_id__in=user_ids).delete()

        AuditLog.objects.create(
            user=request.user,
            user_ip=request.META.get("REMOTE_ADDR"),
            action=AuditLog.ActionType.BULK_ACTION,
            entity_type="UserBadge",
            entity_repr=f"Revoke {badge.name} from {deleted_count} users",
            metadata={
                "action": "revoke",
                "badge_id": badge.id,
                "badge_name": badge.name,
                "users_revoked": deleted_count,
            },
        )

        # Invalidate user caches for all affected users
        from apps.users.services.cache import invalidate_user_caches

        users = User.objects.filter(id__in=user_ids)
        for user in users:
            invalidate_user_caches(user.id, user.username, trigger_stats_update=False)

        return Response({"message": f"Badge revoked from {deleted_count} users successfully."})

    @action(detail=True, methods=["get"])
    def holders(self, request, pk=None):
        """Get list of users holding this badge."""
        badge = self.get_object()
        user_badges = (
            UserBadge.objects.filter(badge=badge)
            .select_related("user", "granted_by")
            .order_by("-granted_at")
        )

        paginator = AdminPagination()
        page = paginator.paginate_queryset(user_badges, request)

        data = [
            {
                "id": ub.id,
                "user": {
                    "id": ub.user.id,
                    "username": ub.user.username,
                    "avatar": getattr(getattr(ub.user, "userprofile", None), "avatar").url
                    if getattr(getattr(ub.user, "userprofile", None), "avatar", None)
                    else None,
                },
                "granted_by": {
                    "id": ub.granted_by.id,
                    "username": ub.granted_by.username,
                }
                if ub.granted_by
                else None,
                "granted_at": ub.granted_at,
                "reason": ub.reason,
            }
            for ub in page
        ]

        return paginator.get_paginated_response(data)
