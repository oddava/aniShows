import re

from django.core.exceptions import ValidationError

RESERVED_USERNAMES = {
    "admin",
    "api",
    "auth",
    "www",
    "mail",
    "ftp",
    "localhost",
    "root",
    "system",
    "support",
    "help",
    "info",
    "contact",
    "anime",
    "user",
    "users",
    "login",
    "logout",
    "register",
}


def sanitize_username(username: str) -> str:
    """Sanitize and validate username."""
    username = username.strip().lower()

    if len(username) < 3:
        raise ValidationError("Username must be at least 3 characters.")

    if len(username) > 30:
        raise ValidationError("Username must be under 30 characters.")

    if not re.match(r"^[a-z0-9_-]+$", username):
        raise ValidationError(
            "Username can only contain letters, numbers, underscores, and hyphens."
        )

    if username in RESERVED_USERNAMES:
        raise ValidationError("This username is reserved.")

    return username
