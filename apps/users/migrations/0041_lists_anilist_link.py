"""G3 Lists: the linked AniList account for pull-only sync (overview amendment 5)."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0040_lists_entry_constraints_import_job"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserListLink",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "provider",
                    models.CharField(
                        choices=[("anilist", "AniList")], default="anilist", max_length=16
                    ),
                ),
                ("external_username", models.CharField(max_length=50)),
                ("external_user_id", models.IntegerField(blank=True, null=True)),
                ("auto_sync", models.BooleanField(default=False)),
                ("cursor_updated_at", models.BigIntegerField(blank=True, null=True)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.CharField(blank=True, default="", max_length=255)),
                ("consecutive_failures", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="list_link",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["auto_sync", "last_synced_at"],
                        name="users_userl_auto_sy_1ab844_idx",
                    )
                ],
            },
        ),
    ]
