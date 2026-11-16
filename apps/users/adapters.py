import re
import uuid
from urllib.parse import urlparse

import httpx
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile

from ..core.services.admin_settings_service import username_length_limits
from ..shared.logger import logger
from .services.user_queryset import filter_username_ci
from .services.username_sanitizer import validate_username
from .utils.image_processing import ProfileImageError, normalize_profile_image

User = get_user_model()

OAUTH_AVATAR_MAX_BYTES = 2 * 1024 * 1024
# The download runs inside the login request, so keep it short (spec Q3 default).
OAUTH_AVATAR_TIMEOUT_SECONDS = 3.0
TRUSTED_GOOGLE_AVATAR_HOSTS = ("googleusercontent.com",)


def _is_trusted_google_avatar_url(url: str) -> bool:
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    hostname = parsed.hostname.lower()
    return any(
        hostname == host or hostname.endswith(f".{host}") for host in TRUSTED_GOOGLE_AVATAR_HOSTS
    )


def _download_google_avatar(url: str) -> bytes | None:
    if not _is_trusted_google_avatar_url(url):
        logger.warning("Blocked untrusted OAuth avatar URL")
        return None

    with httpx.stream(
        "GET", url, timeout=OAUTH_AVATAR_TIMEOUT_SECONDS, follow_redirects=False
    ) as response:
        if response.status_code != 200:
            return None

        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if not content_type.startswith("image/"):
            logger.warning("Blocked OAuth avatar with non-image content type: %s", content_type)
            return None

        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > OAUTH_AVATAR_MAX_BYTES:
                    logger.warning("Blocked oversized OAuth avatar by content-length")
                    return None
            except ValueError:
                pass

        chunks = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > OAUTH_AVATAR_MAX_BYTES:
                logger.warning("Blocked oversized OAuth avatar during download")
                return None
            chunks.append(chunk)

    return b"".join(chunks)


def _random_suffix() -> str:
    return uuid.uuid4().hex[:4]


def _name_candidate(name: str | None) -> str | None:
    """A display name squeezed into username characters ("Mary Jane" -> "MaryJane")."""
    if not name:
        return None
    return re.sub(r"[^\w.@+-]", "", name) or None


def unique_oauth_username(*candidates: str | None) -> str:
    """A valid username, free ignoring case, from the first candidate that passes the rules.

    Candidates go through ``validate_username`` (length limits, characters,
    reserved names); when none passes, the base is ``user<hex>``.
    """
    _min_length, max_length = username_length_limits()
    base = None
    for candidate in candidates:
        if not candidate:
            continue
        try:
            base = validate_username(candidate)
            break
        except DjangoValidationError:
            continue
    if base is None:
        base = f"user{_random_suffix()}"

    username = base
    while filter_username_ci(User.objects.all(), username).exists():
        suffix = f"_{_random_suffix()}"
        username = f"{base[: max_length - len(suffix)]}{suffix}"
    return username


class MySocialAccountAdapter(DefaultSocialAccountAdapter):
    def populate_user(self, request, sociallogin, data):
        """
        Hook that populates the user instance with data from the social provider.

        The provider's name goes through the same rules as sign-up
        (``validate_username``: length limits, characters, reserved names) and
        is made unique ignoring case (A13).
        """
        user = super().populate_user(request, sociallogin, data)
        # Always set it here: Google sends no username, and allauth's own
        # generator (populate_username in save_user) would skip G1's rules. It
        # keeps a username that is already set.
        # Never from the email address: that would publish a private local part.
        user.username = unique_oauth_username(
            user.username,
            data.get("username"),
            _name_candidate(data.get("first_name")),
            _name_candidate(
                " ".join(filter(None, (data.get("first_name"), data.get("last_name"))))
            ),
        )
        return user

    def save_user(self, request, sociallogin, form=None):
        """
        Hook that saves the user.
        We override this to download the profile picture.
        """
        user = super().save_user(request, sociallogin, form)

        picture_url = sociallogin.account.extra_data.get("picture")

        if picture_url:
            try:
                profile = user.userprofile

                if not profile.avatar:
                    logger.info(f"Downloading OAuth avatar for {user.username} from {picture_url}")
                    avatar_content = _download_google_avatar(picture_url)
                    if avatar_content:
                        avatar = normalize_profile_image(
                            ContentFile(avatar_content, name="google-avatar"),
                            "avatar",
                            max_size=OAUTH_AVATAR_MAX_BYTES,
                        )
                        profile.avatar.save(avatar.name or "avatar.webp", avatar, save=True)
            except ProfileImageError:
                logger.warning("Ignored an unusable OAuth avatar for %s", user.username)
            except Exception:
                logger.exception("Failed to download OAuth avatar for %s", user.username)

        return user
