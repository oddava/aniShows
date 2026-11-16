"""Who may see a user's per-user aggregations (G1 contract, overview section 5).

Lists, activity, stats, favorites, followers/following and ``?user=`` filters ask
this module instead of reading ``UserProfile.is_private`` themselves. Contributions
stay visible in their own context (an anime page, a thread).

The rule (spec 1 Q2 default): a private profile is visible to its owner only;
staff use the admin APIs. Usernames are matched ignoring case (A13), as the
``users_customuser_username_ci_unique`` constraint guarantees one match.
"""

from django.contrib.auth import get_user_model
from django.http import Http404

from .user_queryset import filter_username_ci

User = get_user_model()


def can_view_profile(target_user, viewer) -> bool:
    """Return whether ``viewer`` (a user, ``AnonymousUser`` or ``None``) may see ``target_user``."""
    profile = getattr(target_user, "userprofile", None)
    if profile is None or not profile.is_private:
        return True
    return bool(
        viewer is not None
        and getattr(viewer, "is_authenticated", False)
        and viewer.pk == target_user.pk
    )


def get_visible_user_or_404(username, viewer):
    """Return the user named ``username`` if ``viewer`` may see them, else raise ``Http404``.

    The match ignores case; the returned user carries the canonical ``username``.
    """
    try:
        target_user = filter_username_ci(
            User.objects.select_related("userprofile"), str(username)
        ).get()
    except User.DoesNotExist as exc:
        raise Http404 from exc
    if not can_view_profile(target_user, viewer):
        raise Http404
    return target_user
