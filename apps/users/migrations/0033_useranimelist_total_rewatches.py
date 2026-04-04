from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0032_userprofile_profile_primary_color"),
    ]

    operations = [
        migrations.AddField(
            model_name="useranimelist",
            name="total_rewatches",
            field=models.IntegerField(default=0),
        ),
    ]
