from rest_framework.permissions import SAFE_METHODS, BasePermission

from ..core.services.admin_settings_service import is_email_verification_required
from .models import UserProfile

EMAIL_VERIFICATION_REQUIRED_CODE = "email_verification_required"


def has_verified_email(user) -> bool:
    """Whether ``user`` may create content, honouring the admin's verification setting."""
    if not is_email_verification_required() or user.is_staff:
        return True
    # Queried, not read from user.userprofile: a cached relation can be stale.
    return UserProfile.objects.filter(user_id=user.pk, email_verified=True).exists()


class VerifiedEmailForWrites(BasePermission):
    """Require a verified email for writes that create content or reach other users.

    Reads are open, and DELETE stays allowed so people can always remove their
    own data. Anonymous requests are left to the authentication permissions.
    Unverified accounts are deleted after a week, so anything they create
    would vanish with them.
    """

    message = "Please verify your email address to do this."
    code = EMAIL_VERIFICATION_REQUIRED_CODE

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS or request.method == "DELETE":
            return True
        user = request.user
        if not user or not user.is_authenticated:
            return True
        return has_verified_email(user)
