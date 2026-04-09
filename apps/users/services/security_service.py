"""Security validation utilities."""

from .password_policy import validate_password_strength
from .search_sanitizer import sanitize_search_query
from .username_sanitizer import sanitize_username


class SecurityService:
    """Compatibility wrapper for security validation utilities."""

    # Prevent email enumeration timing attacks
    DUMMY_HASH = "$2b$12$dummyhashforconstanttimecomparison"

    @staticmethod
    def sanitize_username(username: str) -> str:
        return sanitize_username(username)

    @staticmethod
    def validate_password_strength(password: str) -> None:
        validate_password_strength(password)

    @staticmethod
    def sanitize_search_query(query: str) -> str:
        return sanitize_search_query(query)
