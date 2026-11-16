"""Settings owned by G6 Admin.

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

G6 overrides (spec 6, P1-10 / A24), applied in place to ``JAZZMIN_SETTINGS``:

- icon keys use the real app label ``anime`` (``animes.*`` never matched);
- "API Admin" links open the admin SPA (``/admin``), not the JSON dashboard;
- the custom Celery link points at the read-only ``CeleryTaskResultAdmin``;
- ``django_celery_beat`` and ``core.CeleryTaskSchedule`` entries are gone (beat runs
  the file scheduler; removing the app from ``INSTALLED_APPS`` is the integrator's R3);
- ``show_ui_builder`` is off.
"""

from __future__ import annotations

from ..base import JAZZMIN_SETTINGS as _JAZZMIN

__all__: list[str] = []

ADMIN_SPA_URL = "/admin"


def _tune_jazzmin(config: dict) -> None:
    def icon_key(key: str) -> str:
        app, _, model = key.partition(".")
        return f"anime.{model}" if app == "animes" and model else "anime" if key == "animes" else key

    dropped = {"core.CeleryTaskSchedule"}
    icons = {
        icon_key(key): icon
        for key, icon in config["icons"].items()
        if key not in dropped and key.split(".")[0] != "django_celery_beat"
    }
    config["icons"].clear()
    config["icons"].update(icons)

    config["order_with_respect_to"] = [
        app for app in config["order_with_respect_to"] if app != "django_celery_beat"
    ]
    for menu in ("topmenu_links", "usermenu_links"):
        for link in config[menu]:
            if link.get("name") == "API Admin":
                link["name"] = "Admin panel"
                link["url"] = ADMIN_SPA_URL
    config["custom_links"] = {
        "core": [
            {
                "name": "Celery task results",
                "url": "admin:core_celerytaskresult_changelist",
                "icon": "fas fa-tasks",
                "permissions": ["core.view_celerytaskresult"],
            }
        ]
    }
    config["show_ui_builder"] = False


_tune_jazzmin(_JAZZMIN)
