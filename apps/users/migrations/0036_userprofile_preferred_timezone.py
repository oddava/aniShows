from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0035_userprofile_show_adult_content"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="preferred_timezone",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "IANA timezone name for localizing timestamps "
                    "(blank uses auto-detected browser timezone)."
                ),
                max_length=64,
            ),
        ),
    ]
