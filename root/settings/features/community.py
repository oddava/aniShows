"""Settings owned by G5 Community.

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

from ..base import REST_FRAMEWORK

# Community write scopes (spec 5 P0-8). Each scope is its own bucket, so following a
# lot of people never locks a user out of password or email changes (``strict_user``).
_throttle_rates: dict[str, str] = REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]  # type: ignore[assignment]
_throttle_rates.update(
    {
        # Review create / update / delete.
        "review_write": "10/minute",
        # Review reports (a separate 20-per-day cap lives in the review service).
        "review_report": "10/minute",
        # Votes and reactions on reviews.
        "review_interaction": "120/minute",
        # Follow / unfollow ("follow back" sprees in the followers modal stay possible).
        "follow_toggle": "30/minute",
        # Favorite toggles and reorders (anime, characters, staff).
        "favorite_write": "120/minute",
        # Featured-badge changes, forum thread subscriptions, staff moderation actions.
        "community_action": "60/minute",
    }
)

# Reports one user may file per rolling 24 hours (spec 5 P0-5).
REVIEW_REPORTS_PER_DAY = 20
# Distinct ``@mentions`` notified per thread or post (spec 5 P0-10, G4 C-G5-2).
FORUM_MAX_MENTIONS_PER_POST = 10
# Longest forum thread/post body accepted (characters). Every viewer's browser renders it.
FORUM_CONTENT_MAX_LENGTH = 20_000
# Markdown container limits (`>`, `-`, `1.` and list indentation). Deeper nesting makes the
# parser in every viewer's browser hang or overflow its stack, and parse time grows with the
# total marker count. See apps/forums/services/nesting.py (the frontend mirrors both values).
FORUM_MAX_CONTAINER_NESTING = 16
FORUM_MAX_CONTAINER_MARKERS = 1_500
# Subscribers notified about one new post (spec 5 P1-3).
FORUM_SUBSCRIPTION_FANOUT_CAP = 500
