"""Retire the theme-sync fields (D1), in two steps so a rolling deploy stays up.

This release removes ``OfflineAnimeSyncState.themes_status`` /
``themes_attempt_count`` and ``Anime.themes_checked_at`` from Django's model
state only. The columns stay in the database for now: while the deploy runs,
old web replicas and workers still read and write them. The two NOT NULL
columns get database defaults, so rows inserted by the new code (which no
longer sets them) are valid. A migration in the next release drops the
columns (see docs/D1_ANILIST_ONLY_PLAN.md).

It also releases rows held back only by the removed themes stage: their
metadata and franchise stages are done, so they are complete now, and a
quarantine set by the themes stage would otherwise keep them out of public
lists forever. Quarantines set by an admin (``manual``) are kept.
"""

from datetime import timedelta

from django.db import migrations
from django.utils import timezone

SYNCED = "synced"


def release_theme_only_quarantines(apps, schema_editor):
    State = apps.get_model("anime", "OfflineAnimeSyncState")
    (
        State.objects.using(schema_editor.connection.alias)
        .filter(
            quarantined=True,
            quarantine_context__stage="themes",
            metadata_status=SYNCED,
            franchise_status=SYNCED,
        )
        # Containment, not a key lookup: ``NOT (ctx -> 'manual' = true)`` is NULL,
        # so it would also skip every row without the key.
        .exclude(quarantine_context__contains={"manual": True})
        .update(
            quarantined=False,
            quarantine_reason="",
            quarantine_context={},
            last_error_code="",
            last_error_message="",
            # Nothing left to run: park it, as the pipeline does for complete rows.
            next_attempt_at=timezone.now() + timedelta(days=36500),
        )
    )


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0054_backfill_anime_is_adult"),
    ]

    operations = [
        migrations.RunPython(release_theme_only_quarantines, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="offlineanimesyncstate",
            name="anime_sync_th_due_idx",
        ),
        migrations.RunSQL(
            sql=[
                "ALTER TABLE anime_offlineanimesyncstate"
                " ALTER COLUMN themes_status SET DEFAULT 'pending',"
                " ALTER COLUMN themes_attempt_count SET DEFAULT 0",
            ],
            reverse_sql=[
                "ALTER TABLE anime_offlineanimesyncstate"
                " ALTER COLUMN themes_status DROP DEFAULT,"
                " ALTER COLUMN themes_attempt_count DROP DEFAULT",
            ],
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="anime", name="themes_checked_at"),
                migrations.RemoveField(
                    model_name="offlineanimesyncstate", name="themes_attempt_count"
                ),
                migrations.RemoveField(model_name="offlineanimesyncstate", name="themes_status"),
            ],
            database_operations=[],
        ),
    ]
