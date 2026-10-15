from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..tokens import email_verification_token_generator

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
        from ..models import UserProfile
        UserProfile.objects.get_or_create(user=self.user)

    def test_verify_email_returns_tokens(self):
        """Verify-email logs the user in: access token in the body, refresh in the cookie."""
        token = email_verification_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        url = reverse('verify_email', kwargs={'uid': uid, 'token': token})

        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        self.assertTrue(response.cookies[REFRESH_COOKIE_NAME].value)
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

    def test_verification_link_is_single_use(self):
        """A reused link must not mint another session (it used to, for days)."""
        token = email_verification_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        url = reverse('verify_email_body')

        first = self.client.post(url, {'uid': uid, 'token': token})
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertIn('access', first.data)

        self.client.cookies.clear()
        second = self.client.post(url, {'uid': uid, 'token': token})
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data, {'message': 'Email already verified'})
        self.assertNotIn(REFRESH_COOKIE_NAME, second.cookies)

    def test_password_reset_token_cannot_verify_a_verified_account(self):
        from ..models import UserProfile

        UserProfile.objects.filter(user=self.user).update(email_verified=True)
        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        response = self.client.get(reverse('verify_email', kwargs={'uid': uid, 'token': token}))
        self.assertNotIn('access', response.data)

    def test_legacy_link_still_verifies_a_pending_account(self):
        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        response = self.client.get(reverse('verify_email', kwargs={'uid': uid, 'token': token}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
