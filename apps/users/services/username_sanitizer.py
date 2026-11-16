import unicodedata

from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from ...core.services.admin_settings_service import username_length_limits

# Names that collide with routes such as /users/me/.
RESERVED_USERNAMES = frozenset({"me"})

_character_validator = UnicodeUsernameValidator()


def validate_username(value: str) -> str:
    """Return the stripped username or raise ``ValidationError``.

    The single source of username rules for both sign-up and renames.
    """
    # NFKC as create_user's normalize_username does, so a rename cannot slip in
    # a fullwidth or compatibility lookalike of an existing name.
    username = unicodedata.normalize("NFKC", value or "").strip()
    min_length, max_length = username_length_limits()

    if len(username) < min_length:
        raise ValidationError(f"Username must be at least {min_length} characters long.")
    if len(username) > max_length:
        raise ValidationError(f"Username must be at most {max_length} characters long.")
    _character_validator(username)
    if "@" in username:
        try:
            validate_email(username)
        except ValidationError:
            pass
        else:
            # Sign-in reads an email-shaped identifier as an email first, so
            # such a name could be hijacked by an account registered with that
            # address.
            raise ValidationError("A username cannot be an email address.")
    if username.lower() in RESERVED_USERNAMES:
        raise ValidationError("This username is reserved.")

    return username
