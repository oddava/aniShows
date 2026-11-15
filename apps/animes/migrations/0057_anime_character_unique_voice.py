"""One ``AnimeCharacter`` row per (anime, character, voice actor), NULL included.

``unique_together`` let PostgreSQL treat NULL voice actors as distinct, so two
concurrent refreshes of a character without a Japanese voice actor could both
insert it, after which ``update_or_create`` failed on every later refresh of
that anime. Duplicates are removed first, keeping the oldest row.
"""

from django.db import migrations, models


def drop_duplicate_cast_links(apps, schema_editor):
    AnimeCharacter = apps.get_model("anime", "AnimeCharacter")
    rows = AnimeCharacter.objects.using(schema_editor.connection.alias)
    duplicates = (
        rows.order_by()
        .values("anime_id", "character_id", "voice_actor_id")
        .annotate(first_id=models.Min("id"), count=models.Count("id"))
        .filter(count__gt=1)
    )
    for link in duplicates.iterator():
        voice = link["voice_actor_id"]
        same = rows.filter(anime_id=link["anime_id"], character_id=link["character_id"])
        same = same.filter(voice_actor__isnull=True) if voice is None else same.filter(
            voice_actor_id=voice
        )
        same.exclude(id=link["first_id"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0056_anime_staff_unique_credit"),
    ]

    operations = [
        migrations.RunPython(drop_duplicate_cast_links, migrations.RunPython.noop),
        migrations.AlterUniqueTogether(name="animecharacter", unique_together=set()),
        migrations.AddConstraint(
            model_name="animecharacter",
            constraint=models.UniqueConstraint(
                fields=("anime", "character", "voice_actor"),
                nulls_distinct=False,
                name="anime_character_unique_voice",
            ),
        ),
    ]
