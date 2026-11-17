"""Settings owned by G4 Notifications.

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
"""

import os
from typing import cast as _cast

from ..base import REST_FRAMEWORK

# VAPID ``sub`` claim for web push (C-INT-3). Must be a ``mailto:`` or ``https:`` URI.
# Empty means "derive ``mailto:<address>`` from DEFAULT_FROM_EMAIL". The keys themselves
# (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) stay in base.py; generate them with
# ``manage.py generate_vapid_keys``.
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")

# Owner decision D-4 (decided):
# - new-episode emails are opt-in: a user without saved preferences gets none
#   (existing users keep what the G4 migration copied from their old flags);
# - plan-to-watch entries hear about every episode ("all"; "premiere" = episode 1
#   only), but in the app only: no push and no email for them ("in_app"; "all" =
#   the same channels as Watching). Watching entries always get every episode
#   on every channel the user chose.
NEW_USER_EMAIL_EPISODES = False
PLAN_TO_WATCH_ALERTS = "all"
PLAN_TO_WATCH_ALERT_CHANNELS = "in_app"

# One-click email unsubscribe (anonymous, token-authenticated) is throttled per IP.
_throttle_rates = _cast("dict[str, str]", REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"])
_throttle_rates["notification_email_unsubscribe"] = "30/hour"
