# Generated manually for ThemeSong model

from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0023_add_source_season_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="ThemeSong",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "song_type",
                    models.CharField(
                        choices=[("opening", "Opening"), ("ending", "Ending")],
                        max_length=10,
                    ),
                ),
                ("track_number", models.IntegerField(default=1)),
                ("title", models.CharField(max_length=300)),
                ("artist", models.CharField(blank=True, max_length=300)),
                ("episodes", models.CharField(blank=True, max_length=100)),
                (
                    "anilist_raw",
                    models.CharField(blank=True, max_length=500),
                ),
                ("spotify_url", models.URLField(blank=True)),
                ("youtube_url", models.URLField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "anime",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="theme_songs",
                        to="anime.anime",
                    ),
                ),
            ],
            options={
                "ordering": ["song_type", "track_number"],
                "unique_together": {("anime", "song_type", "track_number")},
            },
        ),
        migrations.AddIndex(
            model_name="themesong",
            index=models.Index(
                fields=["anime", "song_type"], name="anime_themes_anime_id_5c3f3e_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="themesong",
            index=models.Index(
                fields=["anime", "track_number"],
                name="anime_themes_anime_id_d3e5f6_idx",
            ),
        ),
    ]
