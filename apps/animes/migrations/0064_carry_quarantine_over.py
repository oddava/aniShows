# Rows the offline pipeline quarantined stay hidden under the catalog's own flag.

from django.db import migrations


def carry_quarantine_over(apps, schema_editor):
    Anime = apps.get_model("anime", "Anime")
    State = apps.get_model("anime", "OfflineAnimeSyncState")
    ids = list(State.objects.filter(quarantined=True).values_list("anime_id", flat=True))
    for start in range(0, len(ids), 1000):
        Anime.objects.filter(id__in=ids[start : start + 1000]).update(
            catalog_excluded="legacy:quarantined"
        )



class Migration(migrations.Migration):

    dependencies = [
        ('anime', '0063_catalog_engine'),
    ]

    operations = [
        # Rows the offline pipeline quarantined (migration 0048: shadow duplicates of
        # fake Jikan IDs, and rows that kept failing) stay hidden, under a reason the
        # scope rule never clears.
        migrations.RunPython(carry_quarantine_over, migrations.RunPython.noop),
    ]
