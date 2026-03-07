from rest_framework import status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.db import transaction
from rest_framework.viewsets import ViewSet

from apps.users import throttling
from apps.animes.serializers import ChangePasswordSerializer
from apps.users.services.email_service import EmailService
from apps.shared.logger import logger

User = get_user_model()


class AccountManagementViewSet(ViewSet):
    """
    ViewSet for managing user account settings like password, email, and deletion.
    Consolidates previously separate APIViews.
    """

    permission_classes = [permissions.IsAuthenticated]

    # Specific actions might need specific rate limiting
    def get_throttles(self):
        if self.action in ["delete_account", "change_email", "confirm_email_change"]:
            return [throttling.StrictUserRateThrottle()]
        return super().get_throttles()

    @action(detail=False, methods=["post"])
    def change_password(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        if serializer.is_valid():
            request.user.set_password(serializer.validated_data["new_password"])
            request.user.save()
            return Response({"message": "Password changed successfully"}, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["delete"])
    def delete_account(self, request):
        """Allow users to delete their own account."""
        user = request.user
        password = request.data.get("password")

        # Log account deletion attempt without sensitive details
        logger.info("Account deletion attempt initiated")

        # Require password confirmation ONLY if user has a usable password
        if user.has_usable_password():
            if not password:
                return Response(
                    {"error": "Your current password is required to delete your account."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_password(password):
                return Response(
                    {"error": "The password you entered is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Pre-delete related records using raw SQL deletes (bypassing signals)
        # to avoid post_delete signals that try to record activity for the user
        with transaction.atomic():
            from apps.users.models import (
                UserAnimeList,
                UserActivity,
                UserStats,
                UserFollow,
                UserBadge,
                SocialLinkChangeLog,
            )
            from apps.animes.models import (
                UserFavorite,
                UserHistory,
                Review,
                ReviewVote,
                ReviewComment,
                UserRecommendation,
            )
            from apps.forums.models import Thread, Post, ThreadLike, PostLike
            from apps.core.models import Notification, PushSubscription

            db = user._state.db or "default"

            # Delete forum-related data (deep cascades)
            PostLike.objects.filter(post__author=user)._raw_delete(db)
            PostLike.objects.filter(user=user)._raw_delete(db)
            ThreadLike.objects.filter(thread__author=user)._raw_delete(db)
            ThreadLike.objects.filter(user=user)._raw_delete(db)
            Post.objects.filter(thread__author=user)._raw_delete(db)
            Post.objects.filter(author=user)._raw_delete(db)
            Thread.objects.filter(author=user)._raw_delete(db)

            # Delete review-related data
            ReviewComment.objects.filter(review__user=user)._raw_delete(db)
            ReviewComment.objects.filter(user=user)._raw_delete(db)
            ReviewVote.objects.filter(review__user=user)._raw_delete(db)
            ReviewVote.objects.filter(user=user)._raw_delete(db)
            Review.objects.filter(user=user)._raw_delete(db)

            # Delete user data
            UserActivity.objects.filter(user=user)._raw_delete(db)
            UserAnimeList.objects.filter(user=user)._raw_delete(db)
            UserFavorite.objects.filter(user=user)._raw_delete(db)
            UserHistory.objects.filter(user=user)._raw_delete(db)
            UserRecommendation.objects.filter(user=user)._raw_delete(db)
            UserStats.objects.filter(user=user)._raw_delete(db)
            UserFollow.objects.filter(follower=user)._raw_delete(db)
            UserFollow.objects.filter(following=user)._raw_delete(db)
            UserBadge.objects.filter(user=user)._raw_delete(db)
            SocialLinkChangeLog.objects.filter(user=user)._raw_delete(db)
            Notification.objects.filter(user=user)._raw_delete(db)
            PushSubscription.objects.filter(user=user)._raw_delete(db)

            user.delete()

        return Response({"message": "Account deleted successfully"}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"])
    def change_email(self, request):
        """Request email change - sends verification to new email."""
        new_email = request.data.get("new_email")
        password = request.data.get("password")
        user = request.user

        if user.has_usable_password():
            if not password:
                return Response(
                    {"error": "Your current password is required to change your email."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not user.check_password(password):
                return Response(
                    {"error": "The password you entered is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
            return Response(
                {"error": "This email is already in use"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email_service = EmailService()
        email_service.send_email_change_confirmation(user, new_email)

        return Response(
            {
                "message": "Confirmation email sent to your new email address. Please check your inbox."
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], permission_classes=[permissions.AllowAny])
    def confirm_email_change(self, request):
        """Confirm email change with token."""
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        new_email_encoded = request.data.get("new_email")

        if not all([uidb64, token, new_email_encoded]):
            return Response(
                {"error": "Missing required fields"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
            new_email = force_str(urlsafe_base64_decode(new_email_encoded))
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response(
                {"error": "Invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST
            )

        if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
            return Response(
                {"error": "This email is already in use"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.email = new_email
        user.save()

        profile = getattr(user, "userprofile", None)
        if profile:
            profile.email_verified = True
            profile.save()

        return Response({"message": "Email changed successfully!"}, status=status.HTTP_200_OK)