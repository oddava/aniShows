# Generated optimization for EC2 instances

from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Add indexes optimized for small EC2 instances.
    Reduces query time for airing anime sync and schedule queries.
    """

    dependencies = [
        ("anime", "0020_anime_anime_anime_popular_5c7763_idx_and_more"),
    ]

    operations = [
        # Composite index for airing sync queries - most important
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["status", "anilist_id"],
                name="anime_status_anilist_idx",
                condition=models.Q(status="Airing"),
            ),
        ),
        # Index for missing airing dates queries
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["status", "next_airing_date"],
                name="anime_airing_date_idx",
            ),
        ),
        # Index for trending rank updates
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["slug", "trending_rank"],
                name="anime_slug_trending_idx",
            ),
        ),
        # Partial index for metadata backfill (anime without characters/staff)
        migrations.AddIndex(
            model_name="anime",
            index=models.Index(
                fields=["popularity_rank"],
                name="anime_popularity_null_chars_idx",
                condition=models.Q(
                    characters__isnull=True,
                    staff__isnull=True,
                ),
            ),
        ),
    ]
