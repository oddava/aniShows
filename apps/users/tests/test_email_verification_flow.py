from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

class EmailVerificationFlowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpassword123'
        )
        self.user.is_active = True
        self.user.save()
        from apps.users.models import UserProfile
        UserProfile.objects.get_or_create(user=self.user)

    def test_verify_email_returns_tokens(self):
        """
        Ensure the VerifyEmailView returns access and refresh tokens upon success.
        """
        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        url = reverse('verify_email', kwargs={'uid': uid, 'token': token})

        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertIn('user', response.data)

        # Verify user is marked as verified
        self.user.refresh_from_db()
        profile = getattr(self.user, 'userprofile', None)
        self.assertTrue(profile.email_verified)

        # Verify token usability
        access_token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        profile_url = reverse('user_profile')
        profile_response = self.client.get(profile_url)
        self.assertEqual(profile_response.status_code, status.HTTP_200_OK)
        self.assertEqual(profile_response.data['email'], self.user.email)

    def test_already_verified_returns_tokens(self):
        """
        Ensure re-verifying an already verified email also returns tokens.
        """
        # Mark as verified
        profile = getattr(self.user, 'userprofile', None)
        if not profile:
             from apps.users.models import UserProfile
             profile, _ = UserProfile.objects.get_or_create(user=self.user)

        profile.email_verified = True
        profile.save()

        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        url = reverse('verify_email', kwargs={'uid': uid, 'token': token})

        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should still return tokens for auto-login
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
