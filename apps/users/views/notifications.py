from collections.abc import Mapping

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.core import signing
from django.db.models import Prefetch, Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from ...animes.models import Anime
from ...core.api_errors import error_response
from ...core.models import Notification, PushSubscription
from ...core.services import notification_preferences, notification_types
from ...core.services.notification_email import read_unsubscribe_token
from ...core.services.notification_service import NotificationService
from ...core.services.push_service import PushService
from ...shared.throttling import ResilientScopedRateThrottle
from ..serializers.notifications import (
    EmailUnsubscribeSerializer,
    NotificationSerializer,
    PushSubscriptionSerializer,
)

_BOOLEAN_PARAMS = {"true": True, "false": False}


class NotificationViewSet(GenericViewSet):
    """ViewSet for managing user notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    # Non-integer ids never reach the ORM (404 from the router, not a 500).
    lookup_value_regex = r"\d+"

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

    def _filtered_queryset(self, params):
        queryset = (
            self.get_queryset()
            .select_related("actor", "actor__userprofile")
            # Avatar fallback reads the actor's Google account: one query, not one per row.
            .prefetch_related(
                Prefetch(
                    "actor__socialaccount_set",
                    queryset=SocialAccount.objects.filter(provider="google").only(
                        "id", "user_id", "extra_data"
                    ),
                )
            )
        )
        errors = {}

        is_read = params.get("is_read")
        if is_read is not None:
            value = _BOOLEAN_PARAMS.get(is_read.strip().lower())
            if value is None:
                errors["is_read"] = ["Must be true or false."]
            else:
                queryset = queryset.filter(is_read=value)

        category = params.get("category")
        if category:
            types = notification_types.TYPES_BY_CATEGORY.get(category)
            if types is None:
                errors["category"] = [f"Unknown category: {category}."]
            else:
                queryset = queryset.filter(notification_type__in=types)

        raw_types = params.get("type")
        if raw_types:
            requested = [t.strip() for t in raw_types.split(",") if t.strip()]
            unknown = [t for t in requested if t not in notification_types.TYPES]
            if unknown:
                errors["type"] = [f"Unknown notification type: {', '.join(unknown)}."]
            elif requested:
                queryset = queryset.filter(notification_type__in=requested)

        if errors:
            raise ValidationError(errors)
        return queryset

    def list(self, request):
        """List notifications, filtered by ``is_read``, ``category`` and ``type`` (a,b)."""
        queryset = self._filtered_queryset(request.query_params)

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
        success = NotificationService.mark_as_read(int(pk), request.user)
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
        if NotificationService.delete_notification(int(pk), request.user):
            return Response(status=status.HTTP_204_NO_CONTENT)
        return error_response(
            "Notification not found",
            code="notification_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class NotificationPreferenceView(APIView):
    """``GET`` the preference matrix with its schema; ``PATCH`` part of it; ``PUT`` all of it."""

    permission_classes = [IsAuthenticated]

    @staticmethod
    def _payload(preferences):
        return {"preferences": preferences, "schema": notification_preferences.schema()}

    def get(self, request):
        return Response(self._payload(notification_preferences.get_preferences(request.user.pk)))

    def _update(self, request, *, replace: bool):
        try:
            preferences = notification_preferences.update_preferences(
                request.user.pk, request.data, replace=replace
            )
        except notification_preferences.PreferenceError as exc:
            raise ValidationError({"preferences": [str(exc)]}) from exc
        return Response(self._payload(preferences))

    def patch(self, request):
        return self._update(request, replace=False)

    def put(self, request):
        return self._update(request, replace=True)


class PushConfigView(APIView):
    """Whether web push is available, and the VAPID key for ``applicationServerKey``."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(PushService.public_config())


class PushSubscriptionViewSet(GenericViewSet):
    """ViewSet for managing push subscriptions."""

    permission_classes = [IsAuthenticated]
    serializer_class = PushSubscriptionSerializer

    def get_queryset(self):
        return PushSubscription.objects.filter(user=self.request.user, is_active=True)

    def create(self, request, *args, **kwargs):
        """Register a push subscription (moves an endpoint to this account)."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        if data.get("refresh"):
            refreshed = PushService.refresh_subscription(
                request.user, data["endpoint"], data["p256dh"], data["auth"]
            )
            if refreshed is None:
                return error_response(
                    "Subscription not found",
                    code="push_subscription_not_found",
                    status_code=status.HTTP_404_NOT_FOUND,
                )
            return Response({"status": "refreshed", "id": refreshed.id})
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

    @action(detail=False, methods=["delete"])
    def unsubscribe(self, request):
        """Remove this device's subscription (by endpoint)."""
        endpoint = request.data.get("endpoint")
        if not endpoint or not isinstance(endpoint, str):
            return error_response(
                "endpoint is required",
                code="missing_endpoint",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if PushService.unsubscribe_user(request.user, endpoint):
            return Response({"status": "unsubscribed"})
        return error_response(
            "Subscription not found",
            code="push_subscription_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    def list(self, request, *args, **kwargs):
        """Get user's active push subscriptions (never their endpoints)."""
        subscriptions = self.get_queryset().values(
            "id", "device_type", "device_info", "created_at", "last_used"
        )
        return Response(list(subscriptions))

    def destroy(self, request, pk=None):
        """Remove one of this user's devices."""
        if PushService.delete_device(request.user, int(pk)):
            return Response(status=status.HTTP_204_NO_CONTENT)
        return error_response(
            "Subscription not found",
            code="push_subscription_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )


class EmailUnsubscribeView(APIView):
    """One-click email unsubscribe (RFC 8058). POST only: link scanners prefetch GETs."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ResilientScopedRateThrottle]
    throttle_scope = "notification_email_unsubscribe"

    def post(self, request):
        body = request.data if isinstance(request.data, Mapping) else {}
        token = request.query_params.get("token") or body.get("token")
        serializer = EmailUnsubscribeSerializer(data={"token": token})
        serializer.is_valid(raise_exception=True)
        try:
            user_id, category = read_unsubscribe_token(serializer.validated_data["token"])
        except signing.BadSignature:
            return error_response(
                "This unsubscribe link is invalid.",
                code="invalid_unsubscribe_token",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if not get_user_model().objects.filter(pk=user_id).exists():
            return error_response(
                "This unsubscribe link is invalid.",
                code="invalid_unsubscribe_token",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        notification_preferences.disable_channel(user_id, category, notification_preferences.EMAIL)
        return Response({"status": "unsubscribed", "category": category})
