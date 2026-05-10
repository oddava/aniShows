import uuid
from urllib.parse import urlparse

import httpx
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile

from ..shared.logger import logger

User = get_user_model()

OAUTH_AVATAR_MAX_BYTES = 2 * 1024 * 1024
TRUSTED_GOOGLE_AVATAR_HOSTS = ("googleusercontent.com",)


def _is_trusted_google_avatar_url(url: str) -> bool:
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    hostname = parsed.hostname.lower()
    return any(
        hostname == host or hostname.endswith(f".{host}")
        for host in TRUSTED_GOOGLE_AVATAR_HOSTS
    )


def _download_google_avatar(url: str) -> bytes | None:
    if not _is_trusted_google_avatar_url(url):
        logger.warning("Blocked untrusted OAuth avatar URL")
        return None

    with httpx.stream("GET", url, timeout=10.0, follow_redirects=False) as response:
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


class MySocialAccountAdapter(DefaultSocialAccountAdapter):
    def populate_user(self, request, sociallogin, data):
        """
        Hook that populates the user instance with data from the social provider.
        We override this to ensure the username is unique.
        """
        user = super().populate_user(request, sociallogin, data)

        username = user.username
        if not username:
            return user

        params = {"username": username}
        if User.objects.filter(**params).exists():
            random_suffix = str(uuid.uuid4())[:4]
            user.username = f"{username}_{random_suffix}"

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
                        filename = f"avatar_{user.pk}.jpg"
                        profile.avatar.save(filename, ContentFile(avatar_content), save=True)
            except Exception:
                logger.exception(f"Failed to download OAuth avatar for {user.username}")

        return user
