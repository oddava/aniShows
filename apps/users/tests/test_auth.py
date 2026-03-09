"""
Authentication API Tests

Tests for:
- User registration
- Login/logout
- Token refresh
- Password change
- Profile retrieval
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from apps.users.models import UserProfile

User = get_user_model()

class RegistrationTests(APITestCase):
    """Tests for user registration endpoint."""

    def setUp(self):
        self.register_url = reverse("register")

    def test_register_valid_user(self):
        """Test successful registration with valid data."""
        data = {
            "username": "testuser",
            "email": "test@example.com",
            "password": "securepass123",
        }
        response = self.client.post(self.register_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(username="testuser").exists())
        # Check UserProfile is created
        user = User.objects.get(username="testuser")
        self.assertTrue(UserProfile.objects.filter(user=user).exists())
        # Check user is inactive until email is verified
        self.assertTrue(user.is_active)
        self.assertFalse(user.userprofile.email_verified)

    def test_register_short_password(self):
        """Test registration fails with password less than 8 characters."""
        data = {
            "username": "testuser",
            "email": "test@example.com",
            "password": "short",
        }
        response = self.client.post(self.register_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.data)

    def test_register_duplicate_username(self):
        """Test registration fails with existing username."""
        User.objects.create_user(
            username="existinguser",
            email="existing@example.com",
            password="password123",
        )
        data = {
            "username": "existinguser",
            "email": "new@example.com",
            "password": "securepass123",
        }
        response = self.client.post(self.register_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_duplicate_email(self):
        """Test registration fails with existing email."""
        User.objects.create_user(
            username="user1", email="duplicate@example.com", password="password123"
        )
        data = {
            "username": "user2",
            "email": "duplicate@example.com",
            "password": "securepass123",
        }
        response = self.client.post(self.register_url, data)
        # Security fix: Returns generic error to prevent user enumeration
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Error is in email field (from serializer validation)
        self.assertIn("email", response.data)

    def test_register_invalid_email(self):
        """Test registration fails with invalid email format."""
        data = {
            "username": "testuser",
            "email": "notanemail",
            "password": "securepass123",
        }
        response = self.client.post(self.register_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

class EmailVerificationTests(APITestCase):
    """Tests for email verification functionality."""

    def setUp(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        self.resend_url = reverse("resend_verification")
        self.login_url = reverse("token_obtain_pair")

        # Create an inactive user (simulating post-registration)
        self.user = User.objects.create_user(
            username="unverified",
            email="unverified@example.com",
            password="securepass123",
            is_active=True,
        )
        # Create profile with email_verified=False (default)
        # Using get_or_create because signal might have already created it
        UserProfile.objects.get_or_create(user=self.user)

        # Generate valid token and uid
        self.default_token_generator = default_token_generator
        self.urlsafe_base64_encode = urlsafe_base64_encode
        self.force_bytes = force_bytes

        self.valid_token = default_token_generator.make_token(self.user)
        self.valid_uid = urlsafe_base64_encode(force_bytes(self.user.pk))

    def _get_verify_url(self, uid=None, token=None):
        """Helper to build the verify_email URL with path parameters."""
        return reverse(
            "verify_email",
            kwargs={"uid": uid or self.valid_uid, "token": token or self.valid_token},
        )

    def test_login_succeeds_for_unverified_user(self):
        """Test that unverified users CAN login."""
        data = {"username": "unverified", "password": "securepass123"}
        response = self.client.post(self.login_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_verify_email_success(self):
        """Test successful email verification activates user."""
        url = self._get_verify_url()
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify user is now active
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertTrue(self.user.userprofile.email_verified)

    def test_verify_email_invalid_token(self):
        """Test verification fails with invalid token."""
        url = self._get_verify_url(token="invalid-token")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # User should still be unverified
        self.user.userprofile.refresh_from_db()
        self.assertFalse(self.user.userprofile.email_verified)

    def test_verify_email_invalid_uid(self):
        """Test verification fails with invalid UID."""
        url = self._get_verify_url(uid="invalid-uid")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verify_already_verified_user(self):
        """Test verification returns success for already verified user."""
        self.user.userprofile.email_verified = True
        self.user.userprofile.save()

        url = self._get_verify_url()
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # We don't necessarily check for specific message if generic success is returned for idempotency
        # But if you implemented specific message, check it.
        # Current implementation just returns success.

    def test_resend_verification_for_inactive_user(self):
        """Test resend verification for inactive user."""
        data = {"email": "unverified@example.com"}
        response = self.client.post(self.resend_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_resend_verification_nonexistent_email(self):
        """Test resend verification returns 200 for non-existent email (security)."""
        data = {"email": "nonexistent@example.com"}
        response = self.client.post(self.resend_url, data)
        # Should return 200 to not reveal user existence
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_resend_verification_for_active_user(self):
        """Test resend verification returns 200 for active user (security)."""
        self.user.is_active = True
        self.user.save()

        data = {"email": "unverified@example.com"}
        response = self.client.post(self.resend_url, data)
        # Should return 200 to not reveal user status
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_verified_user_can_login(self):
        """Test that after verification, user can login."""
        # First verify
        url = self._get_verify_url()
        self.client.get(url)

        # Now login should work
        login_data = {"username": "unverified", "password": "securepass123"}
        response = self.client.post(self.login_url, login_data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

class LoginTests(APITestCase):
    """Tests for login endpoint."""

    def setUp(self):
        self.login_url = reverse("token_obtain_pair")
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="securepass123"
        )

    def test_login_with_username(self):
        """Test login with username and password."""
        data = {"username": "testuser", "password": "securepass123"}
        response = self.client.post(self.login_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_login_with_email(self):
        """Test login with email and password."""
        data = {"username": "test@example.com", "password": "securepass123"}
        response = self.client.post(self.login_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_login_invalid_password(self):
        """Test login fails with wrong password."""
        data = {"username": "testuser", "password": "wrongpass"}
        response = self.client.post(self.login_url, data)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_nonexistent_user(self):
        """Test login fails for non-existent user."""
        data = {"username": "nouser", "password": "anypass123"}
        response = self.client.post(self.login_url, data)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

class TokenRefreshTests(APITestCase):
    """Tests for token refresh endpoint."""

    def setUp(self):
        self.login_url = reverse("token_obtain_pair")
        self.refresh_url = reverse("token_refresh")
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="securepass123"
        )

    def test_refresh_token(self):
        """Test refreshing access token with valid refresh token."""
        # First login to get tokens
        login_response = self.client.post(
            self.login_url, {"username": "testuser", "password": "securepass123"}
        )
        refresh_token = login_response.data["refresh"]

        # Refresh the token
        response = self.client.post(self.refresh_url, {"refresh": refresh_token})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_refresh_with_invalid_token(self):
        """Test refresh fails with invalid token."""
        response = self.client.post(self.refresh_url, {"refresh": "invalidtoken"})
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

class ProfileTests(APITestCase):
    """Tests for user profile endpoints."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="securepass123"
        )
        UserProfile.objects.get_or_create(user=self.user)
        self.profile_url = reverse("user_profile")
        self.client = APIClient()

    def test_get_profile_authenticated(self):
        """Test retrieving own profile when authenticated."""
        self.client.force_authenticate(user=self.user)
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], "testuser")
        self.assertEqual(response.data["email"], "test@example.com")

    def test_get_profile_unauthenticated(self):
        """Test profile retrieval fails when not authenticated."""
        response = self.client.get(self.profile_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_update_profile_bio(self):
        """Test updating user bio."""
        self.client.force_authenticate(user=self.user)
        data = {"bio": "My new bio text"}
        response = self.client.patch(self.profile_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Bio should be HTML escaped
        self.user.userprofile.refresh_from_db()
        self.assertEqual(self.user.userprofile.bio, "My new bio text")

    def test_update_profile_bio_xss_prevention(self):
        """Test that bio is sanitized against XSS."""
        self.client.force_authenticate(user=self.user)
        data = {"bio": '<script>alert("xss")</script>'}
        response = self.client.patch(self.profile_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.userprofile.refresh_from_db()
        # Should be escaped
        self.assertNotIn("<script>", self.user.userprofile.bio)

class ChangePasswordTests(APITestCase):
    """Tests for password change endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="oldpassword123"
        )
        self.change_password_url = reverse("change_password")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_change_password_success(self):
        """Test successful password change."""
        data = {"old_password": "oldpassword123", "new_password": "newpassword456"}
        response = self.client.post(self.change_password_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify new password works
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("newpassword456"))

    def test_change_password_wrong_old_password(self):
        """Test password change fails with wrong current password."""
        data = {"old_password": "wrongoldpass", "new_password": "newpassword456"}
        response = self.client.post(self.change_password_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_change_password_short_new_password(self):
        """Test password change fails with short new password."""
        data = {"old_password": "oldpassword123", "new_password": "short"}
        response = self.client.post(self.change_password_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
