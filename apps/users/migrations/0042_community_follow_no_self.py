"""Forbid self-follows in the database and drop an index the unique pair duplicates."""

from django.db import migrations, models

BATCH_SIZE = 500


def delete_self_follows(apps, schema_editor):
    """Delete existing self-follow rows in batches (the constraint would refuse them)."""
    UserFollow = apps.get_model("users", "UserFollow")
    self_follows = UserFollow.objects.filter(follower=models.F("following"))
    while batch := list(self_follows.values_list("pk", flat=True)[:BATCH_SIZE]):
        UserFollow.objects.filter(pk__in=batch).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0041_lists_anilist_link"),
    ]

    operations = [
        migrations.RunPython(delete_self_follows, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="userfollow",
            constraint=models.CheckConstraint(
                condition=models.Q(("follower", models.F("following")), _negated=True),
                name="users_userfollow_no_self",
            ),
        ),
        migrations.RemoveIndex(
            model_name="userfollow",
            name="users_userf_followe_3f285f_idx",
        ),
    ]
