from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError

from ...core.services.admin_settings_service import username_length_limits

# Names that collide with routes such as /users/me/.
RESERVED_USERNAMES = frozenset({"me"})

_character_validator = UnicodeUsernameValidator()


def validate_username(value: str) -> str:
    """Return the stripped username or raise ``ValidationError``.

    The single source of username rules for both sign-up and renames.
    """
    username = (value or "").strip()
    min_length, max_length = username_length_limits()

    if len(username) < min_length:
        raise ValidationError(f"Username must be at least {min_length} characters long.")
    if len(username) > max_length:
        raise ValidationError(f"Username must be at most {max_length} characters long.")
    _character_validator(username)
    if username.lower() in RESERVED_USERNAMES:
        raise ValidationError("This username is reserved.")

    return username
