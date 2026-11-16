"""Django system checks for configuration that fails quietly at runtime."""

from django.conf import settings
from django.core.checks import Error, Tags, Warning, register


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


# Secret keys that ship in templates, docs, CI or the image build. Any of
# them in production means sessions, password resets and JWTs can be forged.
PLACEHOLDER_SECRET_KEYS = frozenset(
    {
        "change_me_in_production",
        "change_me",
        "change-me",
        "changeme",
        "collectstatic-placeholder",
        "test-secret-key",
        "secret",
        "x",
    }
)
_PLACEHOLDER_SECRET_PREFIXES = (
    "change_me",
    "change-me",
    "changeme",
    "django-insecure-",
    "replace",
    "<",
)
LOCAL_ONLY_HOSTS = frozenset({"", "localhost", "127.0.0.1", "[::1]", "::1", "web", "0.0.0.0"})  # noqa: S104
_BUNDLED_DB_HOSTS = frozenset({"", "db", "localhost", "127.0.0.1"})


def is_placeholder_secret_key(value) -> bool:
    key = (value or "").strip()
    lowered = key.lower()
    return lowered in PLACEHOLDER_SECRET_KEYS or lowered.startswith(_PLACEHOLDER_SECRET_PREFIXES)


@register(Tags.security, deploy=True)
def secret_key_placeholder_check(app_configs, **kwargs):
    """A template or build-time SECRET_KEY must never reach production."""
    if not is_placeholder_secret_key(settings.SECRET_KEY):
        return []
    return [
        Error(
            "DJANGO_SECRET_KEY is a known placeholder value.",
            hint=(
                'Generate one: python -c "import secrets; print(secrets.token_urlsafe(64))" '
                "and set DJANGO_SECRET_KEY in .env."
            ),
            id="core.E010",
        )
    ]


@register(Tags.security, deploy=True)
def allowed_hosts_local_only_check(app_configs, **kwargs):
    """Only local names means every request for the real domain gets a 400."""
    hosts = [str(host).strip().lower() for host in settings.ALLOWED_HOSTS]
    if any(host not in LOCAL_ONLY_HOSTS for host in hosts):
        return []
    return [
        Warning(
            "ALLOWED_HOSTS lists only local names, so requests for the public domain get 400.",
            hint="Set ALLOWED_HOSTS to the public host names (e.g. anishows.com,www.anishows.com).",
            id="core.W011",
        )
    ]


@register(Tags.database, deploy=True)
def external_database_pool_check(app_configs, **kwargs):
    """Without the pool, every process holds CONN_MAX_AGE connections to a shared server."""
    database = settings.DATABASES.get("default", {})
    host = str(database.get("HOST") or "").strip().lower()
    if host in _BUNDLED_DB_HOSTS or getattr(settings, "DB_POOL_MAX_SIZE", 0):
        return []
    return [
        Warning(
            f"The database is external ({host}) but DB_POOL_MAX_SIZE is 0, so its "
            "connection count is not capped per process.",
            hint=(
                "Set DB_POOL_MAX_SIZE (docker-compose.prod.yml defaults to 5) and size "
                "max_connections as in docs/deploy/runbook.md."
            ),
            id="core.W002",
        )
    ]
