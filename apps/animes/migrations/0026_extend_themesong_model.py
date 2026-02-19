# Generated manually for extending ThemeSong model with Jikan fields

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        (
            "anime",
            "0025_rename_anime_themes_anime_id_5c3f3e_idx_anime_theme_anime_i_4cbdb6_idx_and_more",
        ),
    ]

    operations = [
        # Extended fields from Jikan API
        migrations.AddField(
            model_name="themesong",
            name="mal_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="themesong",
            name="composer",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="themesong",
            name="arranger",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.AddField(
            model_name="themesong",
            name="year",
            field=models.IntegerField(blank=True, null=True),
        ),
        # External links
        migrations.AddField(
            model_name="themesong",
            name="apple_music_url",
            field=models.URLField(blank=True),
        ),
        migrations.AddField(
            model_name="themesong",
            name="anisong_db_url",
            field=models.URLField(blank=True),
        ),
        # Metadata
        migrations.AddField(
            model_name="themesong",
            name="last_synced",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="themesong",
            name="sync_source",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]
