import logging
from rest_framework import viewsets, status, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView

from apps.core.models import Notification, PushSubscription
from apps.core.services.notification_service import NotificationService
from apps.core.services.push_service import PushService

logger = logging.getLogger(__name__)


class NotificationSerializer(serializers.ModelSerializer):
    """Serializer for notifications."""

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


class PushSubscriptionSerializer(serializers.ModelSerializer):
    """Serializer for push subscription registration."""

    endpoint = serializers.CharField(required=True)
    p256dh = serializers.CharField(required=True)
    auth = serializers.CharField(required=True)
    device_type = serializers.CharField(default="browser")
    device_info = serializers.JSONField(required=False, default=dict)


class NotificationPreferencesSerializer(serializers.Serializer):
    """Serializer for notification preferences."""

    email_new_episodes = serializers.BooleanField()
    push_new_episodes = serializers.BooleanField()
    push_review_replies = serializers.BooleanField()
    push_new_follower = serializers.BooleanField()


class NotificationPagination(PageNumberPagination):
    """Custom pagination for notifications."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class NotificationViewSet(viewsets.GenericViewSet):
    """ViewSet for managing user notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = NotificationPagination

    def get_queryset(self):
        """Return notifications for the current user."""
        return Notification.objects.filter(user=self.request.user)

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
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
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
            return Response({"status": "marked as read"})
        return Response({"error": "Notification not found"}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        """Mark all notifications as read."""
        count = NotificationService.mark_all_as_read(request.user)
        return Response({"marked_as_read": count})

    def destroy(self, request, pk=None):
        """Delete a notification."""
        try:
            notification = self.get_queryset().get(pk=pk)
            notification.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Notification.DoesNotExist:
            return Response({"error": "Notification not found"}, status=status.HTTP_404_NOT_FOUND)


class NotificationPreferenceView(APIView):
    """View for managing notification preferences."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Get current notification preferences."""
        try:
            profile = request.user.userprofile
            # Use getattr with defaults to handle missing fields during migration
            serializer = NotificationPreferencesSerializer(
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
            return Response(
                {"error": "Failed to get preferences"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def put(self, request):
        """Update notification preferences."""
        serializer = NotificationPreferencesSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            profile = request.user.userprofile
            data = serializer.validated_data

            # Only update fields that exist in the model
            if hasattr(profile, "email_new_episodes"):
                profile.email_new_episodes = data.get(
                    "email_new_episodes", profile.email_new_episodes
                )
            if hasattr(profile, "push_new_episodes"):
                profile.push_new_episodes = data.get("push_new_episodes", profile.push_new_episodes)
            if hasattr(profile, "push_review_replies"):
                profile.push_review_replies = data.get(
                    "push_review_replies", profile.push_review_replies
                )
            if hasattr(profile, "push_new_follower"):
                profile.push_new_follower = data.get("push_new_follower", profile.push_new_follower)

            # Only save fields that actually exist
            update_fields = []
            if hasattr(profile, "email_new_episodes"):
                update_fields.append("email_new_episodes")
            if hasattr(profile, "push_new_episodes"):
                update_fields.append("push_new_episodes")
            if hasattr(profile, "push_review_replies"):
                update_fields.append("push_review_replies")
            if hasattr(profile, "push_new_follower"):
                update_fields.append("push_new_follower")

            if update_fields:
                profile.save(update_fields=update_fields)

            return Response(serializer.data)
        except Exception as e:
            logger.exception(f"Error updating preferences: {e}")
            return Response(
                {"error": "Failed to update preferences"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class PushSubscriptionView(APIView):
    """View for managing push subscriptions."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Register a new push subscription."""
        serializer = PushSubscriptionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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
            return Response(
                {"error": "Failed to subscribe"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def delete(self, request):
        """Unsubscribe from push notifications."""
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response({"error": "endpoint is required"}, status=status.HTTP_400_BAD_REQUEST)

        success = PushService.unsubscribe_user(request.user, endpoint)
        if success:
            return Response({"status": "unsubscribed"})
        return Response({"error": "Subscription not found"}, status=status.HTTP_404_NOT_FOUND)

    def get(self, request):
        """Get user's active push subscriptions."""
        subscriptions = PushSubscription.objects.filter(user=request.user, is_active=True).values(
            "id", "device_type", "device_info", "created_at"
        )
        return Response(list(subscriptions))
