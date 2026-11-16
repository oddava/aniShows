"""Settings owned by G7 Production readiness (settings for every environment; production-only values go in ``root/settings/production.py``, also G7's).

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
Empty in the prep commit: it changes nothing until the group adds to it.
"""

import os

from django.core.exceptions import ImproperlyConfigured

from ..base import DATABASES

# =============================================================================
# DATABASE TLS (external / shared Postgres)
# =============================================================================
# The bundled `db` service needs no TLS (same Docker network). An external or
# shared Postgres usually does: DB_SSLMODE=require (or verify-full together
# with DB_SSLROOTCERT). Unset: libpq's default, as before.

_VALID_SSLMODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}

DB_SSLMODE = os.getenv("DB_SSLMODE", "").strip().lower()
DB_SSLROOTCERT = os.getenv("DB_SSLROOTCERT", "").strip()

if DB_SSLMODE:
    if DB_SSLMODE not in _VALID_SSLMODES:
        raise ImproperlyConfigured(
            f"DB_SSLMODE={DB_SSLMODE!r} is not a libpq sslmode; "
            f"expected one of {', '.join(sorted(_VALID_SSLMODES))}."
        )
    DATABASES["default"]["OPTIONS"]["sslmode"] = DB_SSLMODE
if DB_SSLROOTCERT:
    DATABASES["default"]["OPTIONS"]["sslrootcert"] = DB_SSLROOTCERT

# =============================================================================
# LOGGING FORMAT AND RELEASE
# =============================================================================
# production.py builds LOGGING from LOG_FORMAT: "json" (one object per line,
# with request_id and every extra= key) or "text" (the previous format).

LOG_FORMAT = os.getenv("LOG_FORMAT", "json").strip().lower() or "json"
if LOG_FORMAT not in {"json", "text"}:
    raise ImproperlyConfigured(f"LOG_FORMAT={LOG_FORMAT!r}; expected 'json' or 'text'.")

# The image's git commit (Dockerfile ARG/ENV GIT_SHA, set by CI): the Sentry
# release and what a deploy smoke test can compare against.
GIT_SHA = os.getenv("GIT_SHA", "").strip()
