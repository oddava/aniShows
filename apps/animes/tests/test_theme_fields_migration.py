"""Migration 0055 retires the theme-sync fields without breaking a rolling deploy.

The fields leave Django's model state, but their columns stay until the next
release so old replicas keep working while the deploy runs; inserts from the
new code rely on the column defaults. Rows held back only by the removed
themes stage are released.
"""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("anime", "0054_backfill_anime_is_adult")]
AFTER = [("anime", "0055_drop_theme_sync_fields")]


class ThemeFieldsMigrationTests(TransactionTestCase):
    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _models(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        state_apps = executor.loader.project_state(target).apps
        return state_apps.get_model("anime", "Anime"), state_apps.get_model(
            "anime", "OfflineAnimeSyncState"
        )

    def _state(self, model, anime_model, slug, **fields):
        anime = anime_model.objects.create(title=slug, slug=slug)
        return model.objects.create(anime=anime, **fields)

    def test_only_theme_stage_quarantines_are_released(self):
        anime_model, state_model = self._models(BEFORE)
        synced = {"metadata_status": "synced", "franchise_status": "synced"}
        themes_only = self._state(
            state_model,
            anime_model,
            "themes-only",
            **synced,
            themes_status="quarantined",
            quarantined=True,
            quarantine_reason="not_found",
            quarantine_context={"stage": "themes", "attempts": 2},
        )
        manual = self._state(
            state_model,
            anime_model,
            "manual",
            **synced,
            quarantined=True,
            quarantine_reason="marked_skipped",
            quarantine_context={"stage": "themes", "manual": True},
        )
        metadata = self._state(
            state_model,
            anime_model,
            "metadata",
            metadata_status="quarantined",
            quarantined=True,
            quarantine_reason="identity_conflict",
            quarantine_context={"stage": "metadata", "attempts": 2},
        )

        _, state_model = self._models(AFTER)

        released = state_model.objects.get(pk=themes_only.pk)
        self.assertFalse(released.quarantined)
        self.assertEqual((released.quarantine_reason, released.quarantine_context), ("", {}))
        self.assertTrue(state_model.objects.get(pk=manual.pk).quarantined)
        self.assertTrue(state_model.objects.get(pk=metadata.pk).quarantined)

    def test_columns_stay_for_old_replicas_and_new_inserts_still_work(self):
        anime_model, state_model = self._models(AFTER)
        anime = anime_model.objects.create(title="new", slug="new")
        state_model.objects.create(anime=anime)  # no themes_* values given

        with connection.cursor() as cursor:
            # What an old replica's query still reads.
            cursor.execute("SELECT themes_checked_at FROM anime_anime WHERE id = %s", [anime.pk])
            cursor.execute(
                "SELECT themes_status, themes_attempt_count FROM anime_offlineanimesyncstate"
                " WHERE anime_id = %s",
                [anime.pk],
            )
            self.assertEqual(cursor.fetchone(), ("pending", 0))
