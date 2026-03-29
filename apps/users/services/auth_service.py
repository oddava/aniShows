from typing import Dict

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from rest_framework.exceptions import ValidationError

from apps.core.services.admin_settings_service import is_email_verification_required

User = get_user_model()

class AuthService:
    """Handles authentication business logic."""

    def normalize_login_identifier(self, *, username: str | None = None, email: str | None = None) -> str | None:
        if username:
            normalized_username = username.strip()
            if "@" in normalized_username:
                user = User.objects.filter(email__iexact=normalized_username).only("username").first()
                return user.username if user else normalized_username

            user = User.objects.filter(username__iexact=normalized_username).only("username").first()
            return user.username if user else normalized_username

        if email:
            user = User.objects.filter(email__iexact=email).only("username").first()
            return user.username if user else None

        return None

    def username_exists(self, username: str, *, exclude_pk: int | None = None) -> bool:
        queryset = User.objects.filter(username__iexact=username)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

    def email_exists(self, email: str, *, exclude_pk: int | None = None) -> bool:
        queryset = User.objects.filter(email=email)
        if exclude_pk is not None:
            queryset = queryset.exclude(pk=exclude_pk)
        return queryset.exists()

    def validate_registration_credentials(self, username: str, email: str) -> None:
        generic_message = "Unable to create account. The email or username may already be in use."
        if self.username_exists(username):
            raise ValidationError(generic_message)
        if self.email_exists(email):
            raise ValidationError(generic_message)

    def register_user(self, data: Dict) -> User:
        """Create a new user with profile."""
        user = User.objects.create_user(
            username=data["username"],
            email=data["email"],
            password=data["password"],
        )
        verification_required = is_email_verification_required()
        # Profile is auto-created via signal; sync verification state with panel settings.
        profile = getattr(user, "userprofile", None)
        if profile:
            profile.email_verified = not verification_required
            profile.save()
        return user

    def verify_email(self, uidb64: str, token: str) -> tuple[bool, User | None]:
        """Verify email with token. Returns (success, user)."""
        try:
            from django.utils.encoding import force_str
            from django.utils.http import urlsafe_base64_decode

            from apps.users.views.users import get_annotated_user_queryset

            uid = force_str(urlsafe_base64_decode(uidb64))
            # Get user with annotations for proper serializer output
            user = get_annotated_user_queryset().get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return False, None

        is_valid = default_token_generator.check_token(user, token)
        if is_valid:
            profile = getattr(user, "userprofile", None)
            if profile:
                profile.email_verified = True
                profile.save()

        return is_valid, user if is_valid else None
