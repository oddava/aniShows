"""Pending email change on the profile (G1 P1-3, A14)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0038_accounts_username_ci_unique"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="pending_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="pending_email_requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
