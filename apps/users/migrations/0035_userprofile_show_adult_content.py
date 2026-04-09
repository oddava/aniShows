from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0034_userstats_resonance_count"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="show_adult_content",
            field=models.BooleanField(default=False),
        ),
    ]
