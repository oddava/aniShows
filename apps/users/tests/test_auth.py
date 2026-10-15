"""
Authentication API Tests

Tests for:
- User registration
- Login/logout
- Token refresh
- Password change
- Profile retrieval
"""

from types import SimpleNamespace
from unittest.mock import patch

from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from botocore.exceptions import EndpointConnectionError
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import MultipleObjectsReturned
from django.test import RequestFactory, SimpleTestCase
from django.urls import reverse
from requests.exceptions import RequestException
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from ..auth_cookies import REFRESH_COOKIE_NAME
from ..models import UserProfile
from ..serializers.social_auth import SocialLoginSerializer
from ..views.google import GoogleLogin

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
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("password", response.data["errors"])

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
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("email", response.data["errors"])

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
        self.assertNotIn("refresh", response.data)
        self.assertTrue(response.cookies[REFRESH_COOKIE_NAME].value)

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


class SocialLoginSerializerTests(SimpleTestCase):
    """Unit tests for social login serializer edge cases."""

    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_access_token(self, code):
            return {"access_token": "test-access-token"}

    class RecordingClient:
        last_args = None
        last_kwargs = None

        def __init__(self, *args, **kwargs):
            self.__class__.last_args = args
            self.__class__.last_kwargs = kwargs

        def get_access_token(self, code):
            return {"access_token": "test-access-token"}

    class RequestFailingClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_access_token(self, code):
            raise RequestException("google unreachable")

    class DummyProvider:
        app = SimpleNamespace(client_id="client-id", secret="client-secret")

    class DummyAdapter:
        provider_id = "google"
        access_token_method = "POST"
        access_token_url = "https://oauth2.example/token"
        scope_delimiter = " "
        headers = {}
        basic_auth = False
        expires_in_key = "expires_in"

        def __init__(self, request):
            self.request = request

        def get_provider(self):
            return SocialLoginSerializerTests.DummyProvider()

        def parse_token(self, tokens):
            return SimpleNamespace(app=None, token=tokens["access_token"])

    class BrokenConfigAdapter:
        provider_id = "google"

        def __init__(self, request):
            self.request = request

        def get_provider(self):
            raise MultipleObjectsReturned("Multiple Google social apps configured")

    def setUp(self):
        self.request_factory = RequestFactory()
        self.callback_url = f"{settings.FRONTEND_URL}/auth/google/callback"
        self.view = SimpleNamespace(
            adapter_class=self.DummyAdapter,
            client_class=self.DummyClient,
            callback_url=self.callback_url,
        )

    @patch("apps.users.serializers.social_auth.SocialLoginSerializer.get_social_login")
    def test_oauth2_error_is_mapped_to_validation_error(self, mock_get_social_login):
        """OAuth2Error from Google login completion should be surfaced as serializer validation error."""
        mock_get_social_login.side_effect = OAuth2Error("Invalid id_token")
        request = self.request_factory.post("/api/v1/auth/google/", {"code": "fake-code"})

        serializer = SocialLoginSerializer(
            data={"code": "fake-code"},
            context={"request": request, "view": self.view},
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)
        self.assertEqual(serializer.errors["non_field_errors"][0], "Incorrect value")

    def test_provider_config_error_is_mapped_to_validation_error(self):
        """Misconfigured provider setup should not produce a server error."""
        request = self.request_factory.post("/api/v1/auth/google/", {"code": "fake-code"})
        broken_view = SimpleNamespace(
            adapter_class=self.BrokenConfigAdapter,
            client_class=self.DummyClient,
            callback_url=self.callback_url,
        )

        serializer = SocialLoginSerializer(
            data={"code": "fake-code"},
            context={"request": request, "view": broken_view},
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)
        self.assertEqual(
            serializer.errors["non_field_errors"][0],
            "Social login is temporarily unavailable.",
        )

    @patch.object(SocialLoginSerializer.auth_service, "finalize_social_login")
    @patch("apps.users.serializers.social_auth.complete_social_login")
    @patch("apps.users.serializers.social_auth.SocialLoginSerializer.get_social_login")
    def test_finalize_social_login_error_is_mapped_to_validation_error(
        self,
        mock_get_social_login,
        mock_complete_social_login,
        mock_finalize_social_login,
    ):
        """Unexpected signup/finalization failures should not produce a server error."""
        mock_get_social_login.return_value = SimpleNamespace()
        mock_complete_social_login.return_value = None
        mock_finalize_social_login.side_effect = RuntimeError("post-save signal failure")
        request = self.request_factory.post("/api/v1/auth/google/", {"code": "fake-code"})

        serializer = SocialLoginSerializer(
            data={"code": "fake-code"},
            context={"request": request, "view": self.view},
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)
        self.assertEqual(
            serializer.errors["non_field_errors"][0],
            "Failed to finalize social login.",
        )

    @patch.object(SocialLoginSerializer.auth_service, "finalize_social_login")
    @patch("apps.users.serializers.social_auth.complete_social_login")
    @patch("apps.users.serializers.social_auth.SocialLoginSerializer.get_social_login")
    def test_google_client_is_initialized_without_legacy_scope_positional_arg(
        self,
        mock_get_social_login,
        mock_complete_social_login,
        mock_finalize_social_login,
    ):
        """OAuth client init should match the current allauth signature."""
        mock_get_social_login.return_value = SimpleNamespace(account=SimpleNamespace(user=SimpleNamespace()))
        mock_complete_social_login.return_value = None
        mock_finalize_social_login.return_value = SimpleNamespace()
        request = self.request_factory.post("/api/v1/auth/google/", {"code": "fake-code"})
        view = SimpleNamespace(
            adapter_class=self.DummyAdapter,
            client_class=self.RecordingClient,
            callback_url=self.callback_url,
        )

        serializer = SocialLoginSerializer(
            data={"code": "fake-code"},
            context={"request": request, "view": view},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(len(self.RecordingClient.last_args), 6)
        self.assertEqual(self.RecordingClient.last_kwargs["scope_delimiter"], " ")

    def test_request_exception_during_token_exchange_is_mapped_to_validation_error(self):
        """Transient token exchange failures should not bubble up as 500s."""
        request = self.request_factory.post("/api/v1/auth/google/", {"code": "fake-code"})
        failing_view = SimpleNamespace(
            adapter_class=self.DummyAdapter,
            client_class=self.RequestFailingClient,
            callback_url=self.callback_url,
        )

        serializer = SocialLoginSerializer(
            data={"code": "fake-code"},
            context={"request": request, "view": failing_view},
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)
        self.assertEqual(
            serializer.errors["non_field_errors"][0],
            "Failed to exchange code for access token",
        )


class GoogleLoginViewTests(SimpleTestCase):
    """Regression tests for Google callback URL resolution."""

    def test_resolve_callback_url_uses_configured_default_without_super_lookup(self):
        request = RequestFactory().post("/api/v1/auth/google/", {})

        view = GoogleLogin()

        self.assertEqual(
            view._resolve_callback_url(request),
            f"{settings.FRONTEND_URL}/auth/google/callback",
        )

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
        self.user.userprofile.refresh_from_db()
        self.assertEqual(self.user.userprofile.bio, "My new bio text")

    def test_update_profile_bio_xss_prevention(self):
        """Test that unsafe tags are stripped from bio."""
        self.client.force_authenticate(user=self.user)
        data = {"bio": '<script>alert("xss")</script>'}
        response = self.client.patch(self.profile_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.userprofile.refresh_from_db()
        self.assertNotIn("<script>", self.user.userprofile.bio)
        self.assertIn('alert("xss")', self.user.userprofile.bio)

    @patch("apps.users.views.users.update_user_profile")
    def test_update_profile_returns_503_when_media_storage_unavailable(self, mock_update):
        """Storage connectivity failures should return a clear 503 response."""
        mock_update.side_effect = EndpointConnectionError(
            endpoint_url="http://anishows-minio:9000"
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.patch(self.profile_url, {"bio": "updated"})

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn("detail", response.data)

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

    def test_change_password_rejects_common_password(self):
        data = {"old_password": "oldpassword123", "new_password": "password123"}
        response = self.client.post(self.change_password_url, data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data["errors"])

    def test_change_password_revokes_other_sessions_but_keeps_this_one(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        other_device = RefreshToken.for_user(self.user)
        data = {"old_password": "oldpassword123", "new_password": "N3w-Passphrase!"}
        response = self.client.post(self.change_password_url, data)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        new_cookie = response.cookies[REFRESH_COOKIE_NAME].value

        refresh_url = reverse("token_refresh")
        headers = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}
        anon = APIClient()
        anon.cookies[REFRESH_COOKIE_NAME] = str(other_device)
        self.assertEqual(anon.post(refresh_url, **headers).status_code, 401)
        anon.cookies[REFRESH_COOKIE_NAME] = new_cookie
        self.assertEqual(anon.post(refresh_url, **headers).status_code, 200)


class PasswordResetConfirmTests(APITestCase):
    def setUp(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        self.user = User.objects.create_user(
            username="resetuser", email="reset@example.com", password="oldpassword123"
        )
        self.url = reverse("password_reset_confirm")
        self.payload = {
            "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
            "token": default_token_generator.make_token(self.user),
        }

    def test_rejects_weak_password(self):
        for weak in ("a", "12345678", "password"):
            with self.subTest(password=weak):
                response = self.client.post(self.url, {**self.payload, "password": weak})
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpassword123"))

    def test_reset_revokes_existing_sessions(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        stolen = RefreshToken.for_user(self.user)
        response = self.client.post(self.url, {**self.payload, "password": "N3w-Passphrase!"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.client.cookies[REFRESH_COOKIE_NAME] = str(stolen)
        refresh = self.client.post(reverse("token_refresh"), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(refresh.status_code, status.HTTP_401_UNAUTHORIZED)


class ProfilePatchPrivacyTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="privateuser", email="p@example.com", password="pw-123456"
        )
        UserProfile.objects.update_or_create(user=self.user, defaults={"is_private": True})
        self.client.force_authenticate(user=self.user)

    def test_patch_without_is_private_keeps_profile_private(self):
        """Toggling an unrelated setting used to make private profiles public."""
        for data in ({"show_adult_content": True}, {"bio": "hi"}):
            with self.subTest(data=data):
                response = self.client.patch(reverse("user_profile"), data, format="json")
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.user.userprofile.refresh_from_db()
                self.assertTrue(self.user.userprofile.is_private)

    def test_non_string_social_link_fields_are_rejected_not_500(self):
        response = self.client.patch(
            reverse("user_profile"),
            {"social_links": [{"platform": 1, "value": "x"}]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
