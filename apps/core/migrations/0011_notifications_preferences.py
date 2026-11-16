"""G4: per-user notification preferences, copied from the four legacy UserProfile flags.

The legacy flags stay untouched (dropping them is deferred), so the reverse step
(delete every row) loses nothing.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

BATCH_SIZE = 1000


def legacy_to_preferences(email_new_episodes, push_new_episodes, push_review_replies, push_new_follower):
    """The frozen legacy mapping (spec 4, "Frozen: preference schema")."""
    return {
        "episodes": {
            "in_app": True,
            "push": bool(push_new_episodes),
            "email": bool(email_new_episodes),
        },
        "replies": {"in_app": True, "push": bool(push_review_replies)},
        "likes": {"in_app": True, "push": bool(push_review_replies)},
        "follows": {"in_app": True, "push": bool(push_new_follower)},
        "account": {"in_app": True, "push": True},
    }


def copy_legacy_flags(apps, schema_editor):
    UserProfile = apps.get_model("users", "UserProfile")
    NotificationPreference = apps.get_model("core", "NotificationPreference")
    last_id = 0
    while True:
        rows = list(
            UserProfile.objects.filter(id__gt=last_id)
            .order_by("id")
            .values_list(
                "id",
                "user_id",
                "email_new_episodes",
                "push_new_episodes",
                "push_review_replies",
                "push_new_follower",
            )[:BATCH_SIZE]
        )
        if not rows:
            break
        last_id = rows[-1][0]
        NotificationPreference.objects.bulk_create(
            [
                NotificationPreference(user_id=user_id, preferences=legacy_to_preferences(*flags))
                for _id, user_id, *flags in rows
            ],
            ignore_conflicts=True,
        )


def delete_preferences(apps, schema_editor):
    apps.get_model("core", "NotificationPreference").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_notifications_dedupe_actor_push"),
        # The four legacy flags have had their final names since users.0019.
        ("users", "0019_rename_email_new_follower_userprofile_push_new_follower_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationPreference",
            fields=[
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="notification_preference",
                        serialize=False,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("preferences", models.JSONField(blank=True, default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.RunPython(copy_legacy_flags, delete_preferences),
    ]
