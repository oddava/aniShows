from django.db.models import Q
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.fields import BooleanField, CharField, JSONField
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import ModelSerializer, Serializer
from rest_framework.viewsets import GenericViewSet

from ...animes.models import Anime
from ...core.api_errors import error_response
from ...core.models import Notification, PushSubscription
from ...core.services.notification_service import NotificationService
from ...core.services.push_service import PushService
from ...shared.logger import logger


class NotificationSerializer(ModelSerializer):
    def to_representation(self, instance):
        representation = super().to_representation(instance)
        cover_payload = getattr(instance, "_notification_cover_payload", None)
        if cover_payload:
            data = dict(representation.get("data") or {})
            for key, value in cover_payload.items():
                if value and not data.get(key):
                    data[key] = value
            representation["data"] = data
        return representation

    class Meta:
        model = Notification
        fields = [
            "id",
            "notification_type",
            "title",
            "message",
            "data",
            "is_read",
            "created_at",
            "read_at",
        ]
        read_only_fields = ["id", "created_at", "read_at"]

class PushSubscriptionSerializer(ModelSerializer):
    endpoint = CharField(required=True)
    p256dh = CharField(required=True)
    auth = CharField(required=True)
    device_type = CharField(default="browser")
    device_info = JSONField(required=False, default=dict)

    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "device_type", "device_info", "created_at"]


class NotificationPreferencesSerializer(Serializer):
    email_new_episodes = BooleanField()
    push_new_episodes = BooleanField()
    push_review_replies = BooleanField()
    push_new_follower = BooleanField()


class NotificationViewSet(GenericViewSet):
    """ViewSet for managing user notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Return notifications for the current user."""
        return Notification.objects.filter(user=self.request.user)

    @staticmethod
    def _has_cover_payload(data: dict) -> bool:
        return any(
            data.get(key)
            for key in (
                "anime_cover_image_small",
                "anime_cover_image_medium",
                "anime_cover_image",
                "anime_cover",
                "cover_image",
            )
        )

    @classmethod
    def _attach_anime_cover_payloads(cls, notifications):
        notifications = list(notifications)
        anime_ids = set()
        anime_slugs = set()

        for notification in notifications:
            data = notification.data or {}
            if cls._has_cover_payload(data):
                continue
            anime_id = data.get("anime_id")
            anime_slug = data.get("anime_slug")
            if isinstance(anime_id, int):
                anime_ids.add(anime_id)
            elif isinstance(anime_id, str) and anime_id.isdigit():
                anime_ids.add(int(anime_id))
            if isinstance(anime_slug, str) and anime_slug:
                anime_slugs.add(anime_slug)

        if not anime_ids and not anime_slugs:
            return notifications

        anime_queryset = Anime.objects.only(
            "id",
            "slug",
            "cover_image",
            "cover_image_external_url",
        )
        anime_by_id = {}
        anime_by_slug = {}
        for anime in anime_queryset.filter(Q(id__in=anime_ids) | Q(slug__in=anime_slugs)):
            anime_by_id[anime.id] = anime
            anime_by_slug[anime.slug] = anime

        for notification in notifications:
            data = notification.data or {}
            anime = None
            anime_id = data.get("anime_id")
            if isinstance(anime_id, str) and anime_id.isdigit():
                anime_id = int(anime_id)
            if isinstance(anime_id, int):
                anime = anime_by_id.get(anime_id)
            if anime is None:
                anime = anime_by_slug.get(data.get("anime_slug"))
            if anime is not None:
                notification._notification_cover_payload = (
                    NotificationService.get_anime_cover_payload(anime)
                )

        return notifications

    def list(self, request):
        """List notifications with optional filtering."""
        queryset = self.get_queryset()

        # Filter by read status
        is_read = request.query_params.get("is_read")
        if is_read is not None:
            is_read_bool = is_read.lower() == "true"
            queryset = queryset.filter(is_read=is_read_bool)

        # Filter by type
        notification_type = request.query_params.get("type")
        if notification_type:
            queryset = queryset.filter(notification_type=notification_type)

        # Paginate
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(
                self._attach_anime_cover_payloads(page),
                many=True,
            )
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(
            self._attach_anime_cover_payloads(queryset),
            many=True,
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        """Get count of unread notifications."""
        count = NotificationService.get_unread_count(request.user)
        return Response({"count": count})

    @action(detail=True, methods=["patch"])
    def mark_read(self, request, pk=None):
        """Mark a specific notification as read."""
        success = NotificationService.mark_as_read(pk, request.user)
        if success:
            return Response(
                {
                    "status": "marked as read",
                    "unread_count": NotificationService.get_unread_count(request.user),
                }
            )
        return error_response(
            "Notification not found",
            code="notification_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        """Mark all notifications as read."""
        count = NotificationService.mark_all_as_read(request.user)
        return Response({"marked_as_read": count, "unread_count": 0})

    def destroy(self, request, pk=None):
        """Delete a notification."""
        if NotificationService.delete_notification(pk, request.user):
            return Response(status=status.HTTP_204_NO_CONTENT)
        return error_response(
            "Notification not found",
            code="notification_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class NotificationPreferenceView(generics.RetrieveUpdateAPIView):
    """View for managing notification preferences."""

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationPreferencesSerializer

    def get_object(self):
        return self.request.user.userprofile

    def get(self, request, *args, **kwargs):
        """Get current notification preferences."""
        try:
            profile = self.get_object()
            # Use getattr with defaults to handle missing fields during migration
            serializer = self.get_serializer(
                {
                    "email_new_episodes": getattr(profile, "email_new_episodes", True),
                    "push_new_episodes": getattr(profile, "push_new_episodes", True),
                    "push_review_replies": getattr(profile, "push_review_replies", True),
                    "push_new_follower": getattr(profile, "push_new_follower", True),
                }
            )
            return Response(serializer.data)
        except Exception as e:
            logger.exception(f"Error getting preferences: {e}")
            return error_response(
                "Failed to get preferences",
                code="notification_preferences_unavailable",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def update(self, request, *args, **kwargs):
        """Update notification preferences."""
        profile = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            data = serializer.validated_data

            update_fields = []
            for field in ["email_new_episodes", "push_new_episodes", "push_review_replies", "push_new_follower"]:
                if hasattr(profile, field) and field in data:
                    setattr(profile, field, data[field])
                    update_fields.append(field)

            if update_fields:
                profile.save(update_fields=update_fields)

            return Response(serializer.data)
        except Exception as e:
            logger.exception(f"Error updating preferences: {e}")
            return error_response(
                "Failed to update preferences",
                code="notification_preferences_update_failed",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class PushSubscriptionViewSet(GenericViewSet):
    """ViewSet for managing push subscriptions."""

    permission_classes = [IsAuthenticated]
    serializer_class = PushSubscriptionSerializer

    def get_queryset(self):
        return PushSubscription.objects.filter(user=self.request.user, is_active=True)

    def create(self, request, *args, **kwargs):
        """Register a new push subscription."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            data = serializer.validated_data
            subscription = PushService.subscribe_user(
                user=request.user,
                endpoint=data["endpoint"],
                p256dh=data["p256dh"],
                auth=data["auth"],
                device_type=data.get("device_type", "browser"),
                device_info=data.get("device_info", {}),
            )
            return Response(
                {"status": "subscribed", "id": subscription.id},
                status=status.HTTP_201_CREATED,
            )
        except Exception as e:
            logger.exception(f"Error subscribing to push: {e}")
            return error_response(
                "Failed to subscribe",
                code="push_subscription_failed",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=["delete"])
    def unsubscribe(self, request):
        """Unsubscribe from push notifications."""
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return error_response(
                "endpoint is required",
                code="missing_endpoint",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        success = PushService.unsubscribe_user(request.user, endpoint)
        if success:
            return Response({"status": "unsubscribed"})
        return error_response(
            "Subscription not found",
            code="push_subscription_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    def list(self, request, *args, **kwargs):
        """Get user's active push subscriptions."""
        subscriptions = self.get_queryset().values(
            "id", "device_type", "device_info", "created_at"
        )
        return Response(list(subscriptions))
