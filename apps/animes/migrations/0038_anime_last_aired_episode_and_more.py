from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0037_offlineanimesyncstate"),
    ]

    operations = [
        migrations.AddField(
            model_name="anime",
            name="last_aired_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="anime",
            name="last_aired_episode",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
