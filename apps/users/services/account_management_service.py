from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from apps.users.services.email_service import EmailService

User = get_user_model()


@dataclass(slots=True)
class AccountManagementResult:
    payload: dict
    status_code: int


def change_password(user, new_password):
    user.set_password(new_password)
    user.save()
    return AccountManagementResult(
        payload={"message": "Password changed successfully"},
        status_code=200,
    )


def delete_account(user, password):
    if user.has_usable_password():
        if not password:
            return AccountManagementResult(
                payload={"error": "Your current password is required to delete your account."},
                status_code=400,
            )
        if not user.check_password(password):
            return AccountManagementResult(
                payload={"error": "The password you entered is incorrect."},
                status_code=400,
            )

    with transaction.atomic():
        from apps.animes.models import (
            Review,
            ReviewComment,
            ReviewVote,
            UserFavorite,
            UserHistory,
            UserRecommendation,
        )
        from apps.core.models import Notification, PushSubscription
        from apps.forums.models import Post, PostLike, Thread, ThreadLike
        from apps.users.models import (
            SocialLinkChangeLog,
            UserActivity,
            UserAnimeList,
            UserBadge,
            UserFollow,
            UserStats,
        )

        db = user._state.db or "default"

        PostLike.objects.filter(post__author=user)._raw_delete(db)
        PostLike.objects.filter(user=user)._raw_delete(db)
        ThreadLike.objects.filter(thread__author=user)._raw_delete(db)
        ThreadLike.objects.filter(user=user)._raw_delete(db)
        Post.objects.filter(thread__author=user)._raw_delete(db)
        Post.objects.filter(author=user)._raw_delete(db)
        Thread.objects.filter(author=user)._raw_delete(db)

        ReviewComment.objects.filter(review__user=user)._raw_delete(db)
        ReviewComment.objects.filter(user=user)._raw_delete(db)
        ReviewVote.objects.filter(review__user=user)._raw_delete(db)
        ReviewVote.objects.filter(user=user)._raw_delete(db)
        Review.objects.filter(user=user)._raw_delete(db)

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

    return AccountManagementResult(
        payload={"message": "Account deleted successfully"},
        status_code=200,
    )


def request_email_change(user, new_email, password, email_service: EmailService):
    if user.has_usable_password():
        if not password:
            return AccountManagementResult(
                payload={"error": "Your current password is required to change your email."},
                status_code=400,
            )
        if not user.check_password(password):
            return AccountManagementResult(
                payload={"error": "The password you entered is incorrect."},
                status_code=400,
            )

    if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    email_service.send_email_change_confirmation(user, new_email)
    return AccountManagementResult(
        payload={
            "message": "Confirmation email sent to your new email address. Please check your inbox."
        },
        status_code=200,
    )


def confirm_email_change(uidb64, token, new_email_encoded):
    if not all([uidb64, token, new_email_encoded]):
        return AccountManagementResult(payload={"error": "Missing required fields"}, status_code=400)

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
        new_email = force_str(urlsafe_base64_decode(new_email_encoded))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return AccountManagementResult(payload={"error": "Invalid link"}, status_code=400)

    if not default_token_generator.check_token(user, token):
        return AccountManagementResult(
            payload={"error": "Invalid or expired link"},
            status_code=400,
        )

    if User.objects.filter(email=new_email).exclude(pk=user.pk).exists():
        return AccountManagementResult(
            payload={"error": "This email is already in use"},
            status_code=400,
        )

    user.email = new_email
    user.save()

    profile = getattr(user, "userprofile", None)
    if profile:
        profile.email_verified = True
        profile.save()

    return AccountManagementResult(
        payload={"message": "Email changed successfully!"},
        status_code=200,
    )
