from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0043_user_session_version"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="display_name",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="pronouns",
            field=models.CharField(blank=True, default="", max_length=30),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="location",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="status_emoji",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="status_text",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="hidden_sections",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
