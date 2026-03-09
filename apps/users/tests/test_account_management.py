from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.users.models import UserProfile

User = get_user_model()

class AccountManagementTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpassword123'
        )
        self.profile, _ = UserProfile.objects.update_or_create(user=self.user, defaults={'email_verified': True})
        self.client.force_authenticate(user=self.user)

        # URLs
        self.delete_account_url = reverse('delete_account')
        self.change_email_url = reverse('change_email')
        self.confirm_email_url = reverse('confirm_email_change')
        self.resend_url = reverse('resend_verification')

    def test_delete_account(self):
        """Test account deletion with correct password."""
        # Initial check
        self.assertEqual(User.objects.count(), 1)

        data = {'password': 'testpassword123'}
        response = self.client.delete(self.delete_account_url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(User.objects.count(), 0)

    def test_delete_account_wrong_password(self):
        """Test account deletion fails with wrong password."""
        data = {'password': 'wrongpassword'}
        response = self.client.delete(self.delete_account_url, data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(User.objects.count(), 1)

    def test_change_email_request(self):
        """Test requesting email change sends confirmation email."""
        new_email = 'new@example.com'
        data = {
            'new_email': new_email,
            'password': 'testpassword123'
        }

        response = self.client.post(self.change_email_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Check email sent
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(new_email, mail.outbox[0].to)
        self.assertIn('Confirm your new email', mail.outbox[0].subject)

    def test_change_email_existing(self):
        """Test changing email to existing email fails."""
        User.objects.create_user(username='other', email='taken@example.com', password='pw')

        data = {
            'new_email': 'taken@example.com',
            'password': 'testpassword123'
        }
        response = self.client.post(self.change_email_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resend_verification(self):
        """Test resending verification email."""
        self.profile.email_verified = False
        self.profile.save()

        data = {'email': self.user.email}
        response = self.client.post(self.resend_url, data)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Verify your email', mail.outbox[0].subject)

    def test_resend_verification_already_verified(self):
        """Test resending verification when already verified (should pretend success)."""
        self.profile.email_verified = True
        self.profile.save()

        data = {'email': self.user.email}
        response = self.client.post(self.resend_url, data)

        # Should return 200 but NOT send email (or maybe send "already verified" email?
        # Current implementation raises User.DoesNotExist which returns success message)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # In implementation: check 'if profile and profile.email_verified: raise User.DoesNotExist'
        # So it shouldn't send an email
        self.assertEqual(len(mail.outbox), 0)
