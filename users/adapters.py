from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
import httpx
import uuid
import logging

logger = logging.getLogger(__name__)

User = get_user_model()

class MySocialAccountAdapter(DefaultSocialAccountAdapter):
    def populate_user(self, request, sociallogin, data):
        """
        Hook that populates the user instance with data from the social provider.
        We override this to ensure the username is unique.
        """
        user = super().populate_user(request, sociallogin, data)
        
        # Check if username is taken
        username = user.username
        # Handle empty username case if any
        if not username:
            return user
            
        params = {'username': username}
        if User.objects.filter(**params).exists():
            # If taken, append a random string
            # We use uuid short segment to keep it somewhat clean
            random_suffix = str(uuid.uuid4())[:4]
            user.username = f"{username}_{random_suffix}"
            
        return user

    def save_user(self, request, sociallogin, form=None):
        """
        Hook that saves the user.
        We override this to download the profile picture.
        """
        user = super().save_user(request, sociallogin, form)
        
        # Get profile picture URL from extra_data
        # Google provides 'picture'
        picture_url = sociallogin.account.extra_data.get('picture')
        
        if picture_url:
            try:
                # Get the existing profile (created by signal)
                # Note: signals.py creates profile post_save on User
                profile = user.userprofile
                
                # Check if we should download
                if not profile.avatar:
                    logger.info(f"Downloading OAuth avatar for {user.username} from {picture_url}")
                    response = httpx.get(picture_url)
                    if response.status_code == 200:
                        # Create file for the image field
                        # We guess extension or default to jpg
                        filename = f"avatar_{user.pk}.jpg"
                        profile.avatar.save(filename, ContentFile(response.content), save=True)
            except Exception as e:
                logger.exception(f"Failed to download OAuth avatar for {user.username}")
                
        return user
