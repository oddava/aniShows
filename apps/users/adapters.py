import uuid

import httpx
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile

from ..shared.logger import logger

User = get_user_model()


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
                    response = httpx.get(picture_url, timeout=10.0)
                    if response.status_code == 200:
                        filename = f"avatar_{user.pk}.jpg"
                        profile.avatar.save(filename, ContentFile(response.content), save=True)
            except Exception:
                logger.exception(f"Failed to download OAuth avatar for {user.username}")

        return user
