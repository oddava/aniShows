import re

from django.core.exceptions import ValidationError


def validate_password_strength(password: str) -> None:
    """Enhanced password validation beyond Django defaults."""
    if len(password) < 8:
        raise ValidationError("Password must be at least 8 characters.")

    common_patterns = [
        r"123456",
        r"password",
        r"qwerty",
        r"abc123",
        r"(\w)\1{2,}",
    ]

    for pattern in common_patterns:
        if re.search(pattern, password.lower()):
            raise ValidationError("Password contains common patterns that are easily guessed.")

    has_upper = bool(re.search(r"[A-Z]", password))
    has_lower = bool(re.search(r"[a-z]", password))
    has_digit = bool(re.search(r"\d", password))
    has_special = bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', password))

    variety_score = sum([has_upper, has_lower, has_digit, has_special])

    if variety_score < 3:
        raise ValidationError(
            "Password must contain at least 3 of: uppercase, lowercase, "
            "digits, special characters."
        )
