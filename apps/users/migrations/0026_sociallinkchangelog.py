# Generated manually for SocialLinkChangeLog model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        (
            "users",
            "0025_rename_users_userstats_last_updated_idx_users_users_last_up_fe8429_idx_and_more",
        ),
    ]

    operations = [
        migrations.CreateModel(
            name="SocialLinkChangeLog",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "action",
                    models.CharField(
                        choices=[
                            ("add", "Add"),
                            ("edit", "Edit"),
                            ("delete", "Delete"),
                        ],
                        max_length=20,
                    ),
                ),
                ("old_value", models.JSONField(blank=True, null=True)),
                ("new_value", models.JSONField(default=dict)),
                ("ip_address", models.GenericIPAddressField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="social_link_logs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="sociallinkchangelog",
            index=models.Index(
                fields=["user", "-created_at"], name="soclinklog_user_created_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="sociallinkchangelog",
            index=models.Index(
                fields=["action", "-created_at"], name="soclinklog_action_created_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="sociallinkchangelog",
            index=models.Index(fields=["created_at"], name="soclinklog_created_idx"),
        ),
    ]
