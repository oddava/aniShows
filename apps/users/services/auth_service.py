from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from typing import Dict

User = get_user_model()


class AuthService:
    """Handles authentication business logic."""

    def register_user(self, data: Dict) -> User:
        """Create a new user with profile."""
        user = User.objects.create_user(
            username=data["username"],
            email=data["email"],
            password=data["password"],
        )
        # Profile is auto-created via signal, but ensure email_verified is False
        profile = getattr(user, "userprofile", None)
        if profile:
            profile.email_verified = False
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
