"""One ``AnimeStaff`` row per (anime, staff, role).

Without the constraint, two refreshes of the same anime running at once could
write a credit twice; ``update_or_create`` then raises MultipleObjectsReturned
on every later refresh, so that anime's cast could never change again. Existing
duplicates are removed first, keeping the oldest row.
"""

from django.db import migrations, models


def drop_duplicate_credits(apps, schema_editor):
    AnimeStaff = apps.get_model("anime", "AnimeStaff")
    rows = AnimeStaff.objects.using(schema_editor.connection.alias)
    duplicates = (
        rows.values("anime_id", "staff_id", "role")
        .annotate(first_id=models.Min("id"), count=models.Count("id"))
        .filter(count__gt=1)
    )
    for credit in duplicates.iterator():
        rows.filter(
            anime_id=credit["anime_id"], staff_id=credit["staff_id"], role=credit["role"]
        ).exclude(id=credit["first_id"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0055_drop_theme_sync_fields"),
    ]

    operations = [
        migrations.RunPython(drop_duplicate_credits, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="animestaff",
            constraint=models.UniqueConstraint(
                fields=("anime", "staff", "role"), name="anime_staff_unique_credit"
            ),
        ),
    ]
