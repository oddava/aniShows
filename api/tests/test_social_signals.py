from django.test import TestCase
from django.contrib.auth import get_user_model
from allauth.socialaccount.models import SocialAccount, SocialLogin
from allauth.socialaccount.signals import social_account_added
from users.models import UserProfile
from unittest.mock import MagicMock

User = get_user_model()

class SocialSignalTest(TestCase):
    def test_social_account_auto_verify(self):
        """Test that social account registration automatically verifies the user."""
        user = User.objects.create_user(username='socialuser', email='social@gmail.com', password='password123')
        
        # Manually trigger social_account_added signal
        sociallogin = MagicMock(spec=SocialLogin)
        sociallogin.user = user
        sociallogin.email_addresses = []
        
        # Verify signal creates/updates profile
        social_account_added.send(sender=SocialLogin, request=None, sociallogin=sociallogin)
        
        # Check profile
        profile = UserProfile.objects.get(user=user)
        self.assertTrue(profile.email_verified, "Email should be automatically verified for social login")

    def test_post_save_profile_creation(self):
        """Test that every new user gets a UserProfile via post_save signal."""
        user = User.objects.create_user(username='newuser', email='new@example.com', password='password123')
        
        # Signal should have created the profile
        self.assertTrue(UserProfile.objects.filter(user=user).exists())

    def test_oauth_signup_auto_verify(self):
        """Test that user_signed_up signal automatically verifies OAuth users."""
        from allauth.account.signals import user_signed_up
        user = User.objects.create_user(username='oauthnew', email='oauthnew@gmail.com', password='password123')
        
        # Manually trigger user_signed_up with sociallogin in kwargs
        sociallogin = MagicMock(spec=SocialLogin)
        sociallogin.user = user
        sociallogin.email_addresses = []
        
        user_signed_up.send(sender=User, request=None, user=user, sociallogin=sociallogin)
        
        # Check profile
        profile = UserProfile.objects.get(user=user)
        self.assertTrue(profile.email_verified, "OAuth signup should result in verified profile")

    def test_oauth_signup_integrity_regression(self):
        """Test that unsaved EmailAddress objects don't crash the signup signal."""
        from allauth.account.signals import user_signed_up
        from allauth.account.models import EmailAddress
        user = User.objects.create_user(username='integrityuser', email='integ@gmail.com', password='password123')
        
        sociallogin = MagicMock(spec=SocialLogin)
        sociallogin.user = user
        # Create an unsaved EmailAddress object (no user_id, no pk)
        email_addr = EmailAddress(email='integ@gmail.com', verified=False)
        sociallogin.email_addresses = [email_addr]
        
        # This shouldn't raise IntegrityError now
        user_signed_up.send(sender=User, request=None, user=user, sociallogin=sociallogin)
        
        # Verify state in memory (it should be marked verified, but NOT saved yet)
        self.assertTrue(email_addr.verified)
        self.assertIsNone(email_addr.pk)
