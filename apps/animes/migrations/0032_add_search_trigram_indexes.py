"""
Add GIN trigram indexes for fast text search on anime title, title_jp, and synopsis.

Requires the pg_trgm extension (included by default in most PostgreSQL installations).
These indexes dramatically speed up `icontains` / `LIKE '%query%'` lookups that the
search filter uses, from sequential scans to index-assisted scans.
"""

from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0031_increase_themesong_url_max_length"),
    ]

    operations = [
        # Enable the pg_trgm extension (idempotent - safe if already enabled)
        TrigramExtension(),
        # GIN trigram index on title for fast icontains search
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["title"],
                name="anime_title_trgm_gin",
                opclasses=["gin_trgm_ops"],
            ),
        ),
        # GIN trigram index on title_jp for Japanese title search
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["title_jp"],
                name="anime_title_jp_trgm_gin",
                opclasses=["gin_trgm_ops"],
            ),
        ),
        # GIN trigram index on synopsis for full-text-like search
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["synopsis"],
                name="anime_synopsis_trgm_gin",
                opclasses=["gin_trgm_ops"],
            ),
        ),
    ]
