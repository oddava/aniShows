"""Security validation utilities."""

import re

from django.core.exceptions import ValidationError


class SecurityService:
    """Security validation utilities."""

    # Prevent email enumeration timing attacks
    DUMMY_HASH = "$2b$12$dummyhashforconstanttimecomparison"

    @staticmethod
    def sanitize_username(username: str) -> str:
        """Sanitize and validate username."""
        username = username.strip().lower()

        if len(username) < 3:
            raise ValidationError("Username must be at least 3 characters.")

        if len(username) > 30:
            raise ValidationError("Username must be under 30 characters.")

        # Allow alphanumeric, underscore, hyphen
        if not re.match(r"^[a-z0-9_-]+$", username):
            raise ValidationError(
                "Username can only contain letters, numbers, underscores, and hyphens."
            )

        # Prevent reserved usernames
        reserved = {
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
        if username in reserved:
            raise ValidationError("This username is reserved.")

        return username

    @staticmethod
    def validate_password_strength(password: str) -> None:
        """
        Enhanced password validation beyond Django defaults.
        """
        if len(password) < 8:
            raise ValidationError("Password must be at least 8 characters.")

        # Check for common patterns
        common_patterns = [
            r"123456",
            r"password",
            r"qwerty",
            r"abc123",
            r"(\w)\1{2,}",  # Repeated characters
        ]

        for pattern in common_patterns:
            if re.search(pattern, password.lower()):
                raise ValidationError("Password contains common patterns that are easily guessed.")

        # Require variety
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

    @staticmethod
    def sanitize_search_query(query: str) -> str:
        """Sanitize search queries to prevent injection."""
        # Remove SQL injection attempts
        dangerous_patterns = [
            r"(--|#|/\*|\*/|;)",  # SQL comments
            r"(union|select|insert|update|delete|drop|create)",  # SQL keywords
            r"(javascript:|data:|vbscript:)",  # XSS attempts
        ]

        sanitized = query
        for pattern in dangerous_patterns:
            sanitized = re.sub(pattern, "", sanitized, flags=re.IGNORECASE)

        return sanitized[:100]  # Limit length
