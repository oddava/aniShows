"""Settings owned by G1 Accounts & auth.

Star-imported at the end of ``root/settings/base.py``, so each public name defined
here becomes a setting in every environment. Only the owning group edits this file.

To change a value that ``base.py`` already defines, import it from ``..base`` (it is
fully defined by the time this module runs) and update it in place, e.g.::

    from ..base import REST_FRAMEWORK

    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["example_scope"] = "5/hour"

``test.py`` derives its relaxed throttle rates from base after this runs, so a new
scope is covered there automatically. Never rebind a base name (``REST_FRAMEWORK = {...}``):
it replaces base's value for every group (``test_seams_guard`` fails on it).
Document every override in the group's spec.

Documented overrides (spec 1, "Integrator requests"):
- ``REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]`` follows
  ``API_SESSION_AUTH_ENABLED`` (D-1; default True keeps today's classes).
- ``SIMPLE_JWT["UPDATE_LAST_LOGIN"] = True`` (A33): a password login bumps
  ``last_login``, which is part of the reset-token hash, so an unused reset link
  stops working after the next sign-in.
- New throttle scopes (A09): ``resend_verification`` (its own bucket, no longer
  password reset's) and ``change_email`` (per user).
"""

from typing import cast

from ..base import REST_FRAMEWORK, SIMPLE_JWT, _env_bool

_SESSION_AUTHENTICATION = "rest_framework.authentication.SessionAuthentication"


def _authentication_classes(classes: list[str], *, session_enabled: bool) -> list[str]:
    """``classes`` with DRF's SessionAuthentication kept (or added) or removed."""
    without_session = [name for name in classes if name != _SESSION_AUTHENTICATION]
    if not session_enabled:
        return without_session
    if _SESSION_AUTHENTICATION in classes:
        return list(classes)
    return [*without_session, _SESSION_AUTHENTICATION]


# D-1 (owner decision pending, overview section 11): whether DRF also accepts a
# Django session cookie. True is today's behaviour; the Django admin keeps its own
# session either way. Env: API_SESSION_AUTH_ENABLED (true/false).
API_SESSION_AUTH_ENABLED = _env_bool("API_SESSION_AUTH_ENABLED", True)

REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = _authentication_classes(
    cast("list[str]", REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]),
    session_enabled=API_SESSION_AUTH_ENABLED,
)

SIMPLE_JWT["UPDATE_LAST_LOGIN"] = True

# Throttles (A09). New scopes go through the settings dict so test.py's relaxed
# rates cover them like every other scope.
_throttle_rates = cast("dict[str, str]", REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"])
_throttle_rates["resend_verification"] = "3/hour"
_throttle_rates["change_email"] = "5/hour"

# Failed logins per identifier (any IP) before a 429 with Retry-After, and the
# fixed window they are counted in (apps.users.throttling.LoginIdentifierThrottle).
LOGIN_IDENTIFIER_MAX_FAILURES = 10
LOGIN_IDENTIFIER_WINDOW_SECONDS = 15 * 60
