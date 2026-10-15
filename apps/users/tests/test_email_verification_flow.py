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

    def _verify_url(self, token=None):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = token or email_verification_token_generator.make_token(self.user)
        return reverse('verify_email', kwargs={'uid': uid, 'token': token})

    def _assert_no_session(self, response):
        self.assertNotIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        self.assertNotIn(REFRESH_COOKIE_NAME, response.cookies)

    def test_verify_email_returns_tokens(self):
        """Verify-email logs the user in: access token in the body, refresh in the cookie."""
        response = self.client.post(self._verify_url())
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

    def test_replayed_link_does_not_start_a_session(self):
        """A used verification link reports success but never mints another session."""
        url = self._verify_url()
        first = self.client.post(url)
        self.assertIn('access', first.data)

        replay = self.client.post(url)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertTrue(replay.data['already_verified'])
        self._assert_no_session(replay)

    def test_already_verified_returns_no_session(self):
        """An unexpired link for an already verified user gets a plain success."""
        url = self._verify_url()  # issued while the user was still unverified
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()

        response = self.client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['message'], 'Email already verified')
        self._assert_no_session(response)

    def test_bogus_token_for_verified_user_is_rejected(self):
        """Already-verified status isn't revealed to someone without a genuine link."""
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()

        response = self.client.post(self._verify_url(token='abc-123'))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self._assert_no_session(response)

    def test_password_reset_token_cannot_verify_email(self):
        response = self.client.post(self._verify_url(token=default_token_generator.make_token(self.user)))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.userprofile.refresh_from_db()
        self.assertFalse(self.user.userprofile.email_verified)

    def test_get_is_not_allowed(self):
        """Link prefetchers issue GETs; they must not consume the token."""
        response = self.client.get(self._verify_url())
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.user.userprofile.refresh_from_db()
        self.assertFalse(self.user.userprofile.email_verified)
