"""Re-seed ``Anime.is_adult`` for the AniList-only adult rule (owner decision).

``is_adult`` is now AniList's ``Media.isAdult``. The catalog never stored that
flag, so this seeds it from what tracks it:

- the Hentai genre, which AniList assigns only to ``isAdult`` media;
- a ``hentai`` tag, the offline catalog's mirror of the providers' adult flag
  (the same provisional rule new offline rows get, ``adult_content.py``).

Those rows are flagged. Rows with genres (AniList data) and neither marker are
cleared: thematic tags no longer count, so e.g. The Apothecary Diaries becomes
visible. Rows without genres have no AniList data yet and keep their current
flag; nothing is shown that was hidden before AniList says so.

deploy-prod.sh then queues ``sync_adult_flags``, which replaces the seed with
AniList's own value for every row with an AniList or MAL ID (the weekly task
keeps it there). The work is batched by primary key; it runs in the migration's
transaction. Reversing restores the previous genre/tag rule as frozen in 0054.
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


def _apply(apps, schema_editor, adult_q_for, clearable_q_for=None):
    anime_model = apps.get_model("anime", "Anime")
    alias = schema_editor.connection.alias
    rows = anime_model.objects.using(alias)
    adult = adult_q_for(anime_model, alias)
    clearable = clearable_q_for(anime_model, alias) if clearable_q_for else Q()
    last_pk = 0
    while True:
        pks = list(
            rows.filter(pk__gt=last_pk).order_by("pk").values_list("pk", flat=True)[:BATCH]
        )
        if not pks:
            return
        batch = rows.filter(pk__in=pks)
        batch.filter(adult, is_adult=False).update(is_adult=True)
        batch.exclude(adult).filter(clearable, is_adult=True).update(is_adult=False)
        last_pk = pks[-1]


def _has_genre(anime_model, alias, **genre_filter):
    return Exists(
        anime_model.genres.through.objects.using(alias).filter(
            anime_id=OuterRef("pk"), **genre_filter
        )
    )


def _anilist_seed(anime_model, alias):
    hentai_tag = Q(tags__icontains=f'"{ANILIST_ADULT_GENRE_SLUG}"')
    return Q(_has_genre(anime_model, alias, genre__slug=ANILIST_ADULT_GENRE_SLUG)) | hentai_tag


def _has_anilist_data(anime_model, alias):
    """Rows with genres came from AniList; the others keep their flag for now."""
    return Q(_has_genre(anime_model, alias))


def _legacy_rule(anime_model, alias):
    return Q(
        Exists(
            anime_model.genres.through.objects.using(alias).filter(
                anime_id=OuterRef("pk"), genre__slug__in=LEGACY_ADULT_GENRE_SLUGS
            )
        )
    ) | Q(tags__has_any_keys=LEGACY_ADULT_TAGS)


def seed_from_anilist_genre(apps, schema_editor):
    _apply(apps, schema_editor, _anilist_seed, _has_anilist_data)


def restore_legacy_rule(apps, schema_editor):
    _apply(apps, schema_editor, _legacy_rule)


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0059_community_review_index_cleanup"),
    ]

    operations = [
        migrations.RunPython(seed_from_anilist_genre, restore_legacy_rule, elidable=False),
    ]
