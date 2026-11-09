# Drops the old relations JSON once 0049 has copied it into AnimeRelation.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0049_anime_relation_table"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="anime",
            name="relations_json",
        ),
    ]
