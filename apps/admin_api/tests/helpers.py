"""Shared fixtures for admin API tests: users by role and real Bearer-token clients."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


def make_user(username: str, *, role: str = "regular", **extra):
    """``role`` is ``regular``, ``staff`` or ``superuser``."""
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="pw-123456",
        is_staff=role in {"staff", "superuser"},
        is_superuser=role == "superuser",
        **extra,
    )


def bearer_client(user, **defaults) -> APIClient:
    """An APIClient that authenticates like the SPA: a real JWT access token.

    ``force_authenticate`` would bypass the middleware's view of the user, which is
    exactly what the audit and maintenance fixes are about, so these tests use this.
    """
    client = APIClient(**defaults)
    token = RefreshToken.for_user(user).access_token
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client
