from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0033_useranimelist_total_rewatches"),
    ]

    operations = [
        migrations.AddField(
            model_name="userstats",
            name="resonance_count",
            field=models.IntegerField(default=0),
        ),
    ]
