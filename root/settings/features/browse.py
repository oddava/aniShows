"""Settings owned by G2 Browse & discover.

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

# The longest a public-cache reader waits for another request that is building the
# same payload, before it builds the payload itself (``apps/shared/public_cache.py``).
# Caps ``PUBLIC_API_CACHE_WAIT_TIMEOUT_MS`` (base.py, 30000) without changing it (P0-2).
PUBLIC_API_CACHE_WAIT_CAP_MS = 3000
