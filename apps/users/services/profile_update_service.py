import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ...core.services.admin_settings_service import is_username_change_allowed
from ...core.services.social_links_service import SocialLinksService
from ...shared.logger import logger
from ..models import UserProfile
from .cache import invalidate_user_caches
from .username_sanitizer import validate_username

User = get_user_model()


def update_user_profile(user, validated_data, ip_address: str | None = None) -> None:
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        profile, _ = UserProfile.objects.select_for_update().get_or_create(user=user)
        previous_username = user.username

        _handle_username_change(user, validated_data, profile=profile)

        update_fields = []

        if "avatar" in validated_data:
            profile.avatar = validated_data["avatar"]
            update_fields.append("avatar")
        if "banner" in validated_data:
            profile.banner = validated_data["banner"]
            update_fields.append("banner")
        if validated_data.get("remove_banner"):
            profile.banner = None
            if "banner" not in update_fields:
                update_fields.append("banner")
        if "bio" in validated_data:
            profile.bio = validated_data["bio"]
            update_fields.append("bio")
        if "is_private" in validated_data:
            profile.is_private = validated_data["is_private"]
            update_fields.append("is_private")
        if "show_adult_content" in validated_data:
            profile.show_adult_content = validated_data["show_adult_content"]
            update_fields.append("show_adult_content")
        if "profile_primary_color" in validated_data:
            profile.profile_primary_color = validated_data["profile_primary_color"]
            update_fields.append("profile_primary_color")
        if "preferred_timezone" in validated_data:
            profile.preferred_timezone = validated_data["preferred_timezone"]
            update_fields.append("preferred_timezone")
        if "social_links" in validated_data:
            if _apply_social_links(profile, user, validated_data["social_links"], ip_address):
                update_fields.append("social_links")

        if update_fields:
            profile.save(update_fields=update_fields)

        def invalidate():
            invalidate_user_caches(user.id, user.username)
            if previous_username != user.username:
                # The public profile is also cached under the old name.
                invalidate_user_caches(user.id, previous_username, trigger_stats_update=False)

        transaction.on_commit(invalidate)


def normalize_social_links_input(raw_value):
    if isinstance(raw_value, str):
        try:
            raw_value = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValidationError("Social links must be valid JSON.") from exc

    if not isinstance(raw_value, list):
        raise ValidationError("Social links must be a list.")

    if len(raw_value) > 5:
        raise ValidationError("Maximum 5 social links allowed.")

    cleaned_links = []
    for link in raw_value:
        if not isinstance(link, dict):
            continue
        platform, value = link.get("platform"), link.get("value")
        if not isinstance(platform, str) or not isinstance(value, str):
            raise ValidationError("Social link platform and value must be strings.")
        if platform.strip() and value.strip():
            cleaned_links.append({"platform": platform.strip(), "value": value.strip()})
    return cleaned_links


def validate_social_links_input(raw_value):
    cleaned_links = normalize_social_links_input(raw_value)
    return SocialLinksService().validate_and_process(cleaned_links)


def _handle_username_change(user, validated_data, *, profile=None) -> None:
    new_username = validated_data.get("username")
    if not new_username or new_username == user.username:
        return

    if not is_username_change_allowed():
        raise ValidationError({"username": "Username changes are currently disabled."})

    try:
        normalized_username = validate_username(new_username)
    except DjangoValidationError as exc:
        raise ValidationError({"username": list(exc.messages)}) from exc

    if profile is None:
        profile, _ = UserProfile.objects.select_for_update().get_or_create(user=user)

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


def _apply_social_links(profile, user, new_links, ip_address: str | None) -> bool:
    old_links = profile.social_links if profile.social_links else []

    if _hash_links(old_links) == _hash_links(new_links):
        return False

    service = SocialLinksService()
    try:
        service.log_changes(user, old_links, new_links, ip_address)
    except Exception as exc:
        logger.warning("Failed to log social link changes: %s", exc)

    # ``new_links`` were validated by the serializer; don't redo network checks here.
    profile.social_links = new_links
    old_urls = {link.get("url") or link.get("value") for link in old_links}
    SocialLinksService.schedule_metadata_fetch(
        [link["url"] for link in new_links if link["url"] not in old_urls], user.id
    )
    return True


def _hash_links(links) -> str:
    if not links:
        return ""
    link_strs = []
    for link in sorted(links, key=lambda x: x.get("url", "") + x.get("value", "")):
        url = link.get("url") or link.get("value", "")
        platform = link.get("platform", "")
        link_strs.append(f"{platform}:{url}")
    return "|".join(link_strs)
