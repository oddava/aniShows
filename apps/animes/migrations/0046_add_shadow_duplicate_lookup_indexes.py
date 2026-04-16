from django.db import migrations


def create_shadow_duplicate_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    schema_editor.execute(
        """
        CREATE INDEX CONCURRENTLY IF NOT EXISTS anime_shadow_provider_mal_idx
        ON anime_anime ((provider_ids ->> 'myanimelist'))
        WHERE anilist_id >= 1500000000
          AND banner_image IS NULL
          AND COALESCE(banner_image_external_url, '') = '';
        """
    )
    schema_editor.execute(
        """
        CREATE INDEX CONCURRENTLY IF NOT EXISTS anime_curated_provider_banner_idx
        ON anime_anime ((COALESCE(mal_id::text, provider_ids ->> 'myanimelist')))
        WHERE anilist_id IS NOT NULL
          AND anilist_id < 1500000000
          AND (
            banner_image IS NOT NULL
            OR COALESCE(banner_image_external_url, '') <> ''
          );
        """
    )


def drop_shadow_duplicate_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    schema_editor.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS anime_shadow_provider_mal_idx;"
    )
    schema_editor.execute(
        "DROP INDEX CONCURRENTLY IF EXISTS anime_curated_provider_banner_idx;"
    )


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("anime", "0045_anime_broadcast_fields"),
    ]

    operations = [
        migrations.RunPython(
            create_shadow_duplicate_indexes,
            reverse_code=drop_shadow_duplicate_indexes,
        ),
    ]
