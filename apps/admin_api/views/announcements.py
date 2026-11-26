"""Announcements: staff read, superusers write and broadcast (in-app notices only)."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, SerializerMethodField
from rest_framework.response import Response
from rest_framework.serializers import ModelSerializer
from rest_framework.viewsets import ModelViewSet

from ...core.models import Announcement, AuditLog
from ...core.services.announcement_service import (
    AUDIENCES,
    BODY_MAX_LENGTH,
    announcement_send_is_stuck,
    audience_queryset,
    invalidate_active_announcements,
)
from ...core.services.celery_admin_service import enqueue_tracked_task
from ...shared.errors import ENQUEUE_ERRORS
from ...shared.logger import logger
from ..permissions import AdminPolicyMixin
from ..services.audit import record_admin_action
from .audit_mixins import AuditedModelViewSetMixin

BROADCAST_TASK = "apps.core.tasks.notifications.broadcast_announcement_task"


class AdminAnnouncementSerializer(ModelSerializer):
    body = CharField(max_length=BODY_MAX_LENGTH, required=False, allow_blank=True)
    created_by = SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "body",
            "link_url",
            "link_label",
            "level",
            "is_active",
            "show_banner",
            "starts_at",
            "ends_at",
            "created_by",
            "created_at",
            "updated_at",
            "notify_status",
            "notify_queued_at",
            "notify_audience",
            "notified_at",
            "notified_count",
        ]
        read_only_fields = [
            "created_at",
            "updated_at",
            "notify_status",
            "notify_queued_at",
            "notify_audience",
            "notified_at",
            "notified_count",
        ]

    def get_created_by(self, obj):
        user = obj.created_by
        return {"id": user.id, "username": user.username} if user else None

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise ValidationError({"ends_at": "Must be after the start."})
        link_label = attrs.get("link_label", getattr(self.instance, "link_label", ""))
        link_url = attrs.get("link_url", getattr(self.instance, "link_url", ""))
        if link_label and not link_url:
            raise ValidationError({"link_url": "A link label needs a link."})
        return attrs


class AdminAnnouncementViewSet(AdminPolicyMixin, AuditedModelViewSetMixin, ModelViewSet):
    serializer_class = AdminAnnouncementSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["level", "is_active", "show_banner"]
    search_fields = ["title", "body"]
    ordering_fields = ["created_at", "starts_at", "ends_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Announcement.objects.select_related("created_by")

    def perform_create(self, serializer):
        serializer.validated_data["created_by"] = self.request.user
        super().perform_create(serializer)
        transaction.on_commit(invalidate_active_announcements)

    def perform_update(self, serializer):
        super().perform_update(serializer)
        transaction.on_commit(invalidate_active_announcements)

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        transaction.on_commit(invalidate_active_announcements)

    @action(detail=True, methods=["post"])
    def notify(self, request, pk=None):
        """Queue an in-app notice to ``audience``; a second send needs ``force``."""
        announcement = self.get_object()
        audience = request.data.get("audience", "all")
        if audience not in AUDIENCES:
            return Response(
                {"detail": f"audience must be one of: {', '.join(AUDIENCES)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        force = request.data.get("force") is True
        stuck = announcement_send_is_stuck(announcement)
        if announcement.notify_status == Announcement.NotifyStatus.QUEUED and not (stuck and force):
            return Response(
                {"detail": "This notice is still being sent."},
                status=status.HTTP_409_CONFLICT,
            )
        # Only a finished send needs force; a failed or stuck one may simply be retried
        # (the dedupe key skips members who already have it).
        failed = announcement.notify_status == Announcement.NotifyStatus.FAILED
        if announcement.notified_at and not failed and not force:
            return Response(
                {"detail": "Users were already notified. Send again with force."},
                status=status.HTTP_409_CONFLICT,
            )
        if not announcement.is_active:
            return Response(
                {"detail": "Activate the announcement before notifying users."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        estimated = audience_queryset(audience).count()
        # Claim the send atomically: of two clicks at once, one updates the row
        # and the other finds it already queued. A stuck send may be re-claimed.
        claimable = Announcement.objects.filter(pk=announcement.pk)
        if stuck:
            # Re-claim only the stuck send this request saw: if another admin
            # re-claimed it meanwhile, its queue time changed and this one loses.
            claimable = claimable.filter(
                notify_status=Announcement.NotifyStatus.QUEUED,
                notify_queued_at=announcement.notify_queued_at,
            )
        else:
            claimable = claimable.exclude(notify_status=Announcement.NotifyStatus.QUEUED)
        if not claimable.update(
            notify_status=Announcement.NotifyStatus.QUEUED,
            notify_queued_at=timezone.now(),
            notify_audience=audience,
        ):
            return Response(
                {"detail": "This notice is still being sent."},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            job = enqueue_tracked_task(
                task_path=BROADCAST_TASK,
                user=request.user,
                kwargs={"announcement_id": announcement.id, "audience": audience},
            )
        except ENQUEUE_ERRORS:
            logger.exception("Queueing an announcement failed", extra={"id": announcement.id})
            Announcement.objects.filter(pk=announcement.pk).update(
                notify_status=announcement.notify_status,
                notify_queued_at=announcement.notify_queued_at,
                notify_audience=announcement.notify_audience,
            )
            return Response(
                {"detail": "Failed to queue the notification."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        record_admin_action(
            request,
            action=AuditLog.ActionType.TRIGGER,
            entity_type="Announcement",
            entity_id=announcement.id,
            entity_repr=f"Notify {audience}: {announcement.title}",
            metadata={
                "operation": "notify",
                "audience": audience,
                "force": force,
                "estimated_recipients": estimated,
                "task_id": job.task_id,
            },
        )
        return Response(
            {
                "message": "Notification queued.",
                "audience": audience,
                "estimated_recipients": estimated,
            },
            status=status.HTTP_202_ACCEPTED,
        )
