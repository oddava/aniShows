from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.models import AuditLog
from apps.core.permissions import IsAdminUser
from apps.core.services.notification_service import NotificationService
from apps.shared.logger import logger
from apps.users.models import Badge, UserBadge
from apps.users.serializers.users import BadgeSerializer
from apps.users.services.avatar_service import get_user_avatar_url

User = get_user_model()


class AdminBadgeViewSet(ModelViewSet):
    """Admin CRUD operations for Badges."""

    permission_classes = [IsAdminUser]
    serializer_class = BadgeSerializer
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

            users = list(User.objects.filter(id__in=user_ids))
            existing_user_ids = set(
                UserBadge.objects.filter(
                    badge=badge, user_id__in=[user.id for user in users]
                ).values_list("user_id", flat=True)
            )
            users_to_grant = [user for user in users if user.id not in existing_user_ids]

            if users_to_grant:
                UserBadge.objects.bulk_create(
                    [
                        UserBadge(
                            user=user,
                            badge=badge,
                            granted_by=request.user,
                            reason=reason,
                        )
                        for user in users_to_grant
                    ]
                )

            granted_count = len(users_to_grant)

            for user in users_to_grant:
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

            for user in users_to_grant:
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

        queryset = UserBadge.objects.filter(badge=badge, user_id__in=user_ids)
        deleted_count, _ = queryset.delete()

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
            .select_related("user", "user__userprofile", "granted_by")
            .prefetch_related(
                Prefetch(
                    "user__socialaccount_set",
                    queryset=SocialAccount.objects.filter(provider="google").only(
                        "user_id", "provider", "extra_data"
                    ),
                    to_attr="_prefetched_social_accounts",
                )
            )
            .order_by("-granted_at")
        )

        page = self.paginate_queryset(user_badges)
        results = page if page is not None else user_badges

        data = [
            {
                "id": ub.id,
                "user": {
                    "id": ub.user.id,
                    "username": ub.user.username,
                    "avatar": get_user_avatar_url(ub.user),
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
            for ub in results
        ]

        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)
