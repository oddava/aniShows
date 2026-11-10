"""The beat schedule and Jazzmin config live in their own settings modules.

``snapshots/beat_schedule_and_jazzmin.json`` was captured from ``base.py`` before
they were moved out; every settings module must still produce exactly those
values. Each module is loaded in a fresh interpreter so production settings
never leak into the test process.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from celery.schedules import crontab
from django.test import SimpleTestCase

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "beat_schedule_and_jazzmin.json"

# Pin the tuning settings the schedule reads, so a local .env cannot change it.
SCHEDULE_ENV = {
    "OFFLINE_RECONCILE_BATCH_SIZE": "25",
    "OFFLINE_RECONCILE_CHUNK_SIZE": "100",
    "OFFLINE_RECONCILE_MAX_ROUNDS": "4",
    "OFFLINE_RECONCILE_ROUND_INTERVAL_MINUTES": "15",
    "MEDIA_SELF_HEAL_BATCH_SIZE": "25",
}
SETTINGS_ENV = {
    "DJANGO_SECRET_KEY": "x",
    "CORS_ALLOWED_ORIGINS": "https://example.com",
    "CSRF_TRUSTED_ORIGINS": "https://example.com",
}


def canonical(value):
    """JSON-friendly copy of a settings value (crontabs by their repr)."""
    if isinstance(value, crontab):
        return repr(value)
    if isinstance(value, dict):
        return {str(key): canonical(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [canonical(item) for item in value]
    return value


def _settings_values(module: str) -> dict:
    code = (
        "import importlib, json; "
        "from apps.core.tests.test_settings_split import canonical; "
        f"m = importlib.import_module({module!r}); "
        "print(json.dumps({'CELERY_BEAT_SCHEDULE': canonical(m.CELERY_BEAT_SCHEDULE), "
        "'JAZZMIN_SETTINGS': canonical(m.JAZZMIN_SETTINGS)}))"
    )
    env = {**os.environ, **SETTINGS_ENV, **SCHEDULE_ENV, "DJANGO_SETTINGS_MODULE": module}
    env.pop("SENTRY_DSN", None)
    output = subprocess.run(  # noqa: S603 - fixed interpreter and code
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    ).stdout
    return json.loads(output.strip().splitlines()[-1])


class SettingsSplitTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.snapshot = json.loads(SNAPSHOT_PATH.read_text())

    def test_every_settings_module_sees_the_same_values(self):
        for module in (
            "root.settings.base",
            "root.settings.development",
            "root.settings.test",
            "root.settings.production",
        ):
            with self.subTest(module=module):
                values = _settings_values(module)
                self.assertEqual(
                    sorted(values["CELERY_BEAT_SCHEDULE"]),
                    sorted(self.snapshot["CELERY_BEAT_SCHEDULE"]),
                )
                self.assertEqual(
                    values["CELERY_BEAT_SCHEDULE"], self.snapshot["CELERY_BEAT_SCHEDULE"]
                )
                self.assertEqual(values["JAZZMIN_SETTINGS"], self.snapshot["JAZZMIN_SETTINGS"])

    def test_schedule_kwargs_follow_the_tuning_settings(self):
        from root.settings.celery_schedule import build_beat_schedule

        schedule = build_beat_schedule(
            offline_reconcile_batch_size=1,
            offline_reconcile_chunk_size=2,
            offline_reconcile_max_rounds=3,
            offline_reconcile_round_interval_minutes=4,
            media_self_heal_batch_size=5,
        )
        reconcile = schedule["reconcile-offline-catalog-sync-hourly"]["kwargs"]
        self.assertEqual(
            (
                reconcile["batch_size"],
                reconcile["chunk_size"],
                reconcile["max_rounds"],
                reconcile["round_interval_minutes"],
            ),
            (1, 2, 3, 4),
        )
        self.assertEqual(schedule["heal-missing-media-30min"]["kwargs"], {"batch_size": 5})


class TaskResultStoreTests(SimpleTestCase):
    """core.CeleryTaskResult is the only task-result store (decision D3)."""

    def test_no_celery_result_backend(self):
        from celery.backends.base import DisabledBackend
        from django.conf import settings

        from root.celery import app

        self.assertNotIn("django_celery_results", settings.INSTALLED_APPS)
        self.assertIsNone(settings.CELERY_RESULT_BACKEND)
        # Nothing to expire, so beat does not add its own celery.backend_cleanup entry.
        self.assertIsNone(settings.CELERY_RESULT_EXPIRES)
        self.assertIsInstance(app.backend, DisabledBackend)
