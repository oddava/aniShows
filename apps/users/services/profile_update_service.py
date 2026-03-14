from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.services.admin_settings_service import (
    is_username_change_allowed,
    username_length_limits,
)
from apps.core.services.social_links_service import SocialLinksService
from apps.shared.logger import logger
from apps.users.models import UserProfile
from apps.users.services.cache import invalidate_user_caches

User = get_user_model()


def update_user_profile(user, validated_data, ip_address: str | None = None) -> None:
    _handle_username_change(user, validated_data)

    profile, _ = UserProfile.objects.get_or_create(user=user)

    if "avatar" in validated_data:
        profile.avatar = validated_data["avatar"]
    if "banner" in validated_data:
        profile.banner = validated_data["banner"]
    if validated_data.get("remove_banner"):
        profile.banner = None
    if "bio" in validated_data:
        profile.bio = validated_data["bio"]
    if "is_private" in validated_data:
        profile.is_private = validated_data["is_private"]
    if "social_links" in validated_data:
        _apply_social_links(profile, user, validated_data["social_links"], ip_address)

    profile.save()
    invalidate_user_caches(user.id, user.username)


def _handle_username_change(user, validated_data) -> None:
    new_username = validated_data.get("username")
    if not new_username or new_username == user.username:
        return

    if not is_username_change_allowed():
        raise ValidationError({"username": "Username changes are currently disabled."})

    min_length, max_length = username_length_limits()
    normalized_username = new_username.strip()
    if len(normalized_username) < min_length:
        raise ValidationError({"username": f"Username must be at least {min_length} characters."})
    if len(normalized_username) > max_length:
        raise ValidationError({"username": f"Username must be at most {max_length} characters."})

    profile, _ = UserProfile.objects.get_or_create(user=user)

    if profile.last_username_change:
        elapsed = timezone.now() - profile.last_username_change
        if elapsed < timedelta(days=14):
            days_left = 14 - elapsed.days
            raise ValidationError(
                {"username": f"You can change your username again in {days_left} days."}
            )

    if User.objects.filter(username__iexact=normalized_username).exclude(pk=user.pk).exists():
        raise ValidationError({"username": "This username is already taken."})

    user.username = normalized_username
    user.save(update_fields=["username"])
    profile.last_username_change = timezone.now()
    profile.save(update_fields=["last_username_change"])


def _apply_social_links(profile, user, new_links, ip_address: str | None) -> None:
    old_links = profile.social_links if profile.social_links else []

    if _hash_links(old_links) == _hash_links(new_links):
        return

    service = SocialLinksService()
    try:
        service.log_changes(user, old_links, new_links, ip_address)
    except Exception as exc:
        logger.warning("Failed to log social link changes: %s", exc)

    processed_links = service.validate_and_process(new_links, user, skip_metadata=True)
    profile.social_links = processed_links


def _hash_links(links) -> str:
    if not links:
        return ""
    link_strs = []
    for link in sorted(links, key=lambda x: x.get("url", "") + x.get("value", "")):
        url = link.get("url") or link.get("value", "")
        platform = link.get("platform", "")
        link_strs.append(f"{platform}:{url}")
    return "|".join(link_strs)
