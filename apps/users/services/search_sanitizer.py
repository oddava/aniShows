import re


def sanitize_search_query(query: str) -> str:
    """Sanitize search queries to prevent injection."""
    dangerous_patterns = [
        r"(--|#|/\*|\*/|;)",
        r"(union|select|insert|update|delete|drop|create)",
        r"(javascript:|data:|vbscript:)",
    ]

    sanitized = query
    for pattern in dangerous_patterns:
        sanitized = re.sub(pattern, "", sanitized, flags=re.IGNORECASE)

    return sanitized[:100]
