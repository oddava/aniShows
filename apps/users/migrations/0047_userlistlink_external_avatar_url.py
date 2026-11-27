from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0046_userimportjob_changes"),
    ]

    operations = [
        migrations.AddField(
            model_name="userlistlink",
            name="external_avatar_url",
            field=models.URLField(blank=True, default="", max_length=500),
        ),
    ]
