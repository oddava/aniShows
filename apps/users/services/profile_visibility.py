"""Who may see a user's per-user aggregations (G1 contract, overview section 5).

Lists, activity, stats, favorites, followers/following and ``?user=`` filters ask
this module instead of reading ``UserProfile.is_private`` themselves. Contributions
stay visible in their own context (an anime page, a thread).

Prep-commit stub: the rule is exactly today's inline check (see
``list_service.get_user_anime_list_queryset`` and ``follow_service.ensure_profile_visible``):
a private profile is visible to its owner only. Nothing calls it yet. G1 owns the
implementation (case-insensitive lookup, A13); consumers only call it.
"""

from django.contrib.auth import get_user_model
from django.http import Http404

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

    Exact-case lookup, as the list and activity views do today; G1 switches it to
    ``username__iexact``.
    """
    try:
        target_user = User.objects.select_related("userprofile").get(username=username)
    except User.DoesNotExist as exc:
        raise Http404 from exc
    if not can_view_profile(target_user, viewer):
        raise Http404
    return target_user
