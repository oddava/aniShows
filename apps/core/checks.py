"""Django system checks for configuration that fails quietly at runtime."""

from django.conf import settings
from django.core.checks import Tags, Warning, register


@register(Tags.security, deploy=True)
def safe_browsing_key_check(app_configs, **kwargs):
    """Without the key, social link URLs are never checked against Safe Browsing."""
    if settings.GOOGLE_SAFE_BROWSING_API_KEY:
        return []
    return [
        Warning(
            "GOOGLE_SAFE_BROWSING_API_KEY is not set, so users' social link URLs "
            "are not checked against Google Safe Browsing.",
            hint="Set GOOGLE_SAFE_BROWSING_API_KEY in the environment.",
            id="core.W001",
        )
    ]
