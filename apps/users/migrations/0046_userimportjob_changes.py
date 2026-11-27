from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0045_user_session"),
    ]

    operations = [
        migrations.AddField(
            model_name="userimportjob",
            name="changes",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
