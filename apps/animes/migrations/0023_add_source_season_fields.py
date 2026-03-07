# Generated migration for adding source_material and season fields

from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0022_remove_anime_anime_status_anilist_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="anime",
            name="source_material",
            field=models.CharField(
                blank=True,
                choices=[
                    ("Original", "Original"),
                    ("Manga", "Manga"),
                    ("Light Novel", "Light Novel"),
                    ("Visual Novel", "Visual Novel"),
                    ("Game", "Game"),
                    ("Web Manga", "Web Manga"),
                    ("Novel", "Novel"),
                    ("Music", "Music"),
                    ("Mixed Media", "Mixed Media"),
                    ("Picture Book", "Picture Book"),
                    ("Card Game", "Card Game"),
                    ("Other", "Other"),
                ],
                help_text="Original source material of the anime",
                max_length=50,
            ),
        ),
        migrations.AddField(
            model_name="anime",
            name="season",
            field=models.CharField(
                blank=True,
                help_text="Anime season (WINTER, SPRING, SUMMER, FALL)",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="anime",
            name="season_year",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
