"""Re-seed ``Anime.is_adult`` for the AniList-only adult rule (owner decision).

``is_adult`` is now AniList's ``Media.isAdult``. The catalog never stored that
flag, so this seeds it from the one stored value that tracks it: AniList's
Hentai genre, which AniList assigns only to ``isAdult`` media. Thematic tags no
longer count, so titles such as The Apothecary Diaries become visible.

``manage.py sync_adult_flags`` (run it after this deploy) and the weekly task
then replace the seed with AniList's own value. Batched by primary key so no
single UPDATE holds row locks across the whole table. Reversing restores the
previous genre/tag rule as frozen in 0054.
"""

from django.db import migrations
from django.db.models import Exists, OuterRef, Q

ANILIST_ADULT_GENRE_SLUG = "hentai"
BATCH = 5000

# 0054's rule, frozen, for the reverse direction only.
LEGACY_ADULT_GENRE_SLUGS = ["erotica", "hentai"]
LEGACY_ADULT_TAGS = [
    "ahegao", "anal sex", "ashikoki", "boobjob", "cervix penetration", "cumflation",
    "cunnilingus", "deepthroat", "defloration", "double penetration", "explicit sex",
    "facial", "fellatio", "femdom", "futanari", "group sex", "handjob", "incest", "inseki",
    "irrumatio", "lactation", "masturbation", "mating press", "nakadashi", "netorare",
    "netorase", "netori", "nsfw", "oyakodon", "prostitution", "public sex", "rape",
    "rimjob", "sex", "sex toys", "squirting", "succubus", "sumata", "threesome",
]  # fmt: skip


def _apply(apps, schema_editor, adult_q_for):
    anime_model = apps.get_model("anime", "Anime")
    alias = schema_editor.connection.alias
    rows = anime_model.objects.using(alias)
    adult = adult_q_for(anime_model, alias)
    last_pk = 0
    while True:
        pks = list(
            rows.filter(pk__gt=last_pk).order_by("pk").values_list("pk", flat=True)[:BATCH]
        )
        if not pks:
            return
        batch = rows.filter(pk__in=pks)
        batch.filter(adult, is_adult=False).update(is_adult=True)
        batch.exclude(adult).filter(is_adult=True).update(is_adult=False)
        last_pk = pks[-1]


def _anilist_seed(anime_model, alias):
    return Q(
        Exists(
            anime_model.genres.through.objects.using(alias).filter(
                anime_id=OuterRef("pk"), genre__slug=ANILIST_ADULT_GENRE_SLUG
            )
        )
    )


def _legacy_rule(anime_model, alias):
    return Q(
        Exists(
            anime_model.genres.through.objects.using(alias).filter(
                anime_id=OuterRef("pk"), genre__slug__in=LEGACY_ADULT_GENRE_SLUGS
            )
        )
    ) | Q(tags__has_any_keys=LEGACY_ADULT_TAGS)


def seed_from_anilist_genre(apps, schema_editor):
    _apply(apps, schema_editor, _anilist_seed)


def restore_legacy_rule(apps, schema_editor):
    _apply(apps, schema_editor, _legacy_rule)


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0059_community_review_index_cleanup"),
    ]

    operations = [
        migrations.RunPython(seed_from_anilist_genre, restore_legacy_rule, elidable=False),
    ]
