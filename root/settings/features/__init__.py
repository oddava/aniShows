"""Per-group settings modules for the feature revamp (seams).

``root/settings/base.py`` star-imports each module at its very end, so a group can add
settings, throttle scopes or documented overrides in its own file without touching
``base.py``. The integrator folds them back into ``base.py`` after the last group
merges. See ``docs/plans/feature-revamp-00-overview.md`` (ownership matrix).
"""
