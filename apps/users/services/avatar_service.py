from allauth.socialaccount.models import SocialAccount

from ...shared.media_urls import normalize_media_url

GOOGLE_AVATAR_KEYS = ("picture", "avatar_url", "photoURL", "photoUrl")


def get_user_avatar_url(user):
    """Resolve avatar URL from local profile first, then linked Google account."""
    cached = getattr(user, "_resolved_avatar_url", None)
    if cached is not None:
        return cached

    profile = getattr(user, "userprofile", None)
    if profile and profile.avatar:
        try:
            avatar_url = normalize_media_url(profile.avatar.url)
            if avatar_url:
                user._resolved_avatar_url = avatar_url
                return avatar_url
        except Exception:
            pass

    avatar_url = _get_google_avatar_url(user)
    user._resolved_avatar_url = avatar_url or ""
    return avatar_url


def _get_google_avatar_url(user):
    if not getattr(user, "pk", None):
        return None

    accounts = getattr(user, "_prefetched_social_accounts", None)
    if accounts is None:
        accounts = getattr(user, "_prefetched_objects_cache", {}).get("socialaccount_set")
    if accounts is None:
        accounts = SocialAccount.objects.filter(user=user, provider="google").only("extra_data")

    for account in accounts:
        extra_data = account.extra_data or {}
        for key in GOOGLE_AVATAR_KEYS:
            avatar_url = extra_data.get(key)
            normalized = _normalize_avatar_url(avatar_url)
            if normalized:
                return normalized
    return None


def _normalize_avatar_url(value):
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.startswith("//"):
        return f"https:{candidate}"
    if candidate.startswith(("http://", "https://", "/")):
        return candidate
    return None
