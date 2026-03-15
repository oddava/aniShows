from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0031_seed_initial_badges"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="profile_primary_color",
            field=models.CharField(
                default="#8b5cf6",
                help_text="Hex color for profile accent (e.g., #8b5cf6)",
                max_length=7,
            ),
        ),
    ]
