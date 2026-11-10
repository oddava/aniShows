"""Backfill ``Anime.is_adult`` from the adult-content rule (D5).

The rule is frozen here on purpose (a migration must not change when the app
code does): an adult genre slug, or any explicit tag. It matches
``apps/animes/adult_content.py`` as of this migration. Reversing is a no-op;
reversing 0053 drops the column.
"""

from django.db import migrations
from django.db.models import Exists, OuterRef, Q

ADULT_GENRE_SLUGS = ["erotica", "hentai"]
ADULT_TAGS = [
    "ahegao",
    "anal sex",
    "ashikoki",
    "boobjob",
    "cervix penetration",
    "cumflation",
    "cunnilingus",
    "deepthroat",
    "defloration",
    "double penetration",
    "explicit sex",
    "facial",
    "fellatio",
    "femdom",
    "futanari",
    "group sex",
    "handjob",
    "incest",
    "inseki",
    "irrumatio",
    "lactation",
    "masturbation",
    "mating press",
    "nakadashi",
    "netorare",
    "netorase",
    "netori",
    "nsfw",
    "oyakodon",
    "prostitution",
    "public sex",
    "rape",
    "rimjob",
    "sex",
    "sex toys",
    "squirting",
    "succubus",
    "sumata",
    "threesome",
]


def backfill_is_adult(apps, schema_editor):
    anime_model = apps.get_model("anime", "Anime")
    alias = schema_editor.connection.alias
    anime_genres = anime_model.genres.through
    adult = Q(
        Exists(
            anime_genres.objects.using(alias).filter(
                anime_id=OuterRef("pk"), genre__slug__in=ADULT_GENRE_SLUGS
            )
        )
    ) | Q(tags__has_any_keys=ADULT_TAGS)
    rows = anime_model.objects.using(alias)
    rows.filter(adult, is_adult=False).update(is_adult=True)
    rows.exclude(adult).filter(is_adult=True).update(is_adult=False)


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0053_anime_is_adult"),
    ]

    operations = [
        migrations.RunPython(backfill_is_adult, migrations.RunPython.noop, elidable=False),
    ]
