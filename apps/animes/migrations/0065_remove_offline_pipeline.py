# The retired offline-database pipeline: its tables and Anime columns.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('anime', '0064_carry_quarantine_over'),
    ]

    operations = [
        # Migration 0055 left the theme-sync columns in the database for a rolling
        # deploy. The sync-state table goes now, and so does the leftover Anime
        # column. Reversing puts them back, so older migrations can be unapplied.
        migrations.RunSQL(
            sql=migrations.RunSQL.noop,
            reverse_sql=[
                "ALTER TABLE anime_offlineanimesyncstate"
                " ADD COLUMN IF NOT EXISTS themes_status varchar(30) NOT NULL DEFAULT 'pending',"
                " ADD COLUMN IF NOT EXISTS themes_attempt_count integer NOT NULL DEFAULT 0",
            ],
        ),
        migrations.RunSQL(
            sql=["ALTER TABLE anime_anime DROP COLUMN IF EXISTS themes_checked_at"],
            reverse_sql=[
                "ALTER TABLE anime_anime"
                " ADD COLUMN IF NOT EXISTS themes_checked_at timestamp with time zone NULL",
            ],
        ),
        migrations.RemoveField(
            model_name='offlineanimesyncstate',
            name='anime',
        ),
        migrations.DeleteModel(
            name='OfflineCatalogImport',
        ),
        migrations.RemoveField(
            model_name='anime',
            name='offline_db_last_seen_at',
        ),
        migrations.RemoveField(
            model_name='anime',
            name='offline_db_last_update',
        ),
        migrations.RemoveField(
            model_name='anime',
            name='offline_db_payload',
        ),
        migrations.RemoveField(
            model_name='anime',
            name='source_urls',
        ),
        migrations.DeleteModel(
            name='OfflineAnimeSyncState',
        ),
    ]
