from rest_framework.exceptions import PermissionDenied
from django.contrib.auth import get_user_model

User = get_user_model()


class EmailVerificationMixin:
    """
    Mixin to enforce email verification across viewsets.
    Reduces the repeated check pattern seen in current views.
    """

    require_verified_email = True
    verification_error_message = "Please verify your email to perform this action."

    def check_email_verified(self, user):
        """Check if user has verified email."""
        if not self.require_verified_email:
            return

        profile = getattr(user, "userprofile", None)
        if not profile or not profile.email_verified:
            raise PermissionDenied(self.verification_error_message)

    def perform_create(self, serializer):
        self.check_email_verified(self.request.user)
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        self.check_email_verified(self.request.user)
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only modify your own data.")
        serializer.save()

    def perform_destroy(self, instance):
        self.check_email_verified(self.request.user)
        if instance.user != self.request.user:
            raisee  PermissionDenied("You can only delete your own data.")
        instance.delete()
