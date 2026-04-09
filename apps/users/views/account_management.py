from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.shared.logger import logger
from apps.users import throttling
from apps.users.serializers.users import ChangePasswordSerializer
from apps.users.services.account_management_service import (
    change_password,
    confirm_email_change,
    delete_account,
    request_email_change,
)
from apps.users.services.email_service import EmailService

User = get_user_model()


class AccountManagementViewSet(ViewSet):
    """
    ViewSet for managing user account settings like password, email, and deletion.
    Consolidates previously separate APIViews.
    """

    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        """Allow unauthenticated access only for email change confirmation links."""
        if self.action == "confirm_email_change":
            return [AllowAny()]
        return super().get_permissions()

    def get_throttles(self):
        if self.action in ["delete_account", "change_email", "confirm_email_change"]:
            return [throttling.StrictUserRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["post"])
    def change_password(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        if serializer.is_valid():
            result = change_password(request.user, serializer.validated_data["new_password"])
            return Response(result.payload, status=result.status_code)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["delete"])
    def delete_account(self, request):
        """Allow users to delete their own account."""
        user = request.user
        password = request.data.get("password")

        logger.info("Account deletion attempt initiated")

        result = delete_account(user, password)
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"])
    def change_email(self, request):
        """Request email change - sends verification to new email."""
        new_email = request.data.get("new_email")
        password = request.data.get("password")
        user = request.user

        email_service = EmailService()
        result = request_email_change(user, new_email, password, email_service)
        return Response(result.payload, status=result.status_code)

    @action(detail=False, methods=["post"], permission_classes=[AllowAny])
    def confirm_email_change(self, request):
        """Confirm email change with token."""
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        new_email_encoded = request.data.get("new_email")

        result = confirm_email_change(uidb64, token, new_email_encoded)
        return Response(result.payload, status=result.status_code)
