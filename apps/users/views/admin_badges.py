from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Prefetch
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from ...admin_api.permissions import AdminPolicyMixin
from ...admin_api.services.audit import record_admin_action
from ...core.models import AuditLog
from ..models import Badge, UserBadge
from ..serializers.badges import BadgeSerializer
from ..services.avatar_service import get_user_avatar_url
from ..services.badge_service import grant_badge, revoke_badge

User = get_user_model()

MAX_BADGE_USERS = 500
BADGE_AUDIT_FIELDS = ("name", "description", "icon", "color", "priority", "is_active")


def _clean_user_ids(raw):
    """A non-empty list of at most ``MAX_BADGE_USERS`` integer ids, or ``None``."""
    if not isinstance(raw, list) or not raw or len(raw) > MAX_BADGE_USERS:
        return None
    ids = []
    for value in raw:
        if isinstance(value, bool):
            return None
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            return None
    return sorted(set(ids))


def _badge_snapshot(badge) -> dict:
    return {field: getattr(badge, field) for field in BADGE_AUDIT_FIELDS if hasattr(badge, field)}


class AdminBadgeViewSet(AdminPolicyMixin, ModelViewSet):
    """Badges: staff read; superusers create, edit, delete, grant and revoke (audited)."""

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
            for data, obj in zip(serializer.data, page, strict=False):
                data["holders_count"] = obj.holders_count
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def _audit(self, action_type, badge, **kwargs):
        record_admin_action(
            self.request,
            action=action_type,
            entity_type="Badge",
            entity_id=badge.pk,
            entity_repr=badge.name,
            **kwargs,
        )

    @transaction.atomic
    def perform_create(self, serializer):
        badge = serializer.save(created_by=self.request.user)
        self._audit(AuditLog.ActionType.CREATE, badge, new=_badge_snapshot(badge))

    @transaction.atomic
    def perform_update(self, serializer):
        previous = _badge_snapshot(serializer.instance)
        badge = serializer.save()
        self._audit(
            AuditLog.ActionType.UPDATE, badge, previous=previous, new=_badge_snapshot(badge)
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        self._audit(AuditLog.ActionType.DELETE, instance, previous=_badge_snapshot(instance))
        instance.delete()

    @action(detail=True, methods=["post"])
    def grant(self, request, pk=None):
        """Grant a badge to several users (G5's ``grant_badge`` per user)."""
        badge = self.get_object()
        user_ids = _clean_user_ids(request.data.get("user_ids"))
        reason = request.data.get("reason", "")
        if user_ids is None:
            return Response(
                {"detail": f"Provide a list of at most {MAX_BADGE_USERS} user_ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(reason, str) or len(reason) > 500:
            return Response(
                {"detail": "reason must be a string of at most 500 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            granted_ids = [
                user.pk
                for user in User.objects.filter(id__in=user_ids)
                if grant_badge(user, badge, granted_by=request.user, reason=reason) is not None
            ]
            self._audit(
                AuditLog.ActionType.BULK_ACTION,
                badge,
                metadata={
                    "operation": "grant",
                    "badge_id": badge.pk,
                    "user_ids": granted_ids,
                    "users_granted": len(granted_ids),
                    "total_requested": len(user_ids),
                },
                reason=reason.strip(),
            )

        return Response({"message": f"Badge granted to {len(granted_ids)} users successfully."})

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        """Revoke a badge from several users (G5's ``revoke_badge`` per user)."""
        badge = self.get_object()
        user_ids = _clean_user_ids(request.data.get("user_ids"))
        if user_ids is None:
            return Response(
                {"detail": f"Provide a list of at most {MAX_BADGE_USERS} user_ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            revoked_ids = [
                user.pk
                for user in User.objects.filter(id__in=user_ids)
                if revoke_badge(user, badge)
            ]
            self._audit(
                AuditLog.ActionType.BULK_ACTION,
                badge,
                metadata={
                    "operation": "revoke",
                    "badge_id": badge.pk,
                    "user_ids": revoked_ids,
                    "users_revoked": len(revoked_ids),
                },
            )

        return Response({"message": f"Badge revoked from {len(revoked_ids)} users successfully."})

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
