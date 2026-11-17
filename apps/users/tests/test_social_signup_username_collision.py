"""G1: a social sign-up cannot claim an address equal to an existing username."""

from types import SimpleNamespace
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError

from apps.users.services.auth_service import AuthService

User = get_user_model()
pytestmark = pytest.mark.django_db


def _new_social_login(email):
    return SimpleNamespace(
        is_existing=False,
        user=SimpleNamespace(email=email),
        lookup=mock.Mock(),
        save=mock.Mock(),
        account=SimpleNamespace(user=None),
    )


def test_an_address_equal_to_a_legacy_username_is_refused():
    # A legacy account whose username is an address, with another contact email.
    User.objects.bulk_create([User(username="ann@gmail.com", email="ann.other@example.com")])
    login = _new_social_login("Ann@Gmail.com")

    with pytest.raises(ValidationError):
        AuthService().finalize_social_login(mock.Mock(), login)
    login.save.assert_not_called()


def test_a_fresh_address_signs_up():
    login = _new_social_login("someone.new@example.com")
    AuthService().finalize_social_login(mock.Mock(), login)
    login.save.assert_called_once()
