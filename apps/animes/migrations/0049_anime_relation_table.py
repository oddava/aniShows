# Anime relations become a table (docs/AUDIT.md, Phase 3 item 4).
#
# The ``Anime.relations`` JSON list is renamed out of the way, copied into AnimeRelation
# and dropped in 0050 (a separate migration: dropping the column in the same transaction
# as the inserts trips Postgres' "pending trigger events" check on the deferred FKs).
#
# Backfill rules, matching services/relation_links.py:
# - ``id`` is the AniList ID; legacy fake Jikan IDs (MAL ID + 1.5e9) become NULL and
#   recover the MAL ID;
# - entries that repeat an AniList or MAL ID already seen for the same anime are dropped;
# - ``to_anime`` is linked by AniList ID, then MAL ID, then the stored ``slug``.

import django.db.models.deletion
from django.db import migrations, models

LEGACY_JIKAN_ANILIST_ID_OFFSET = 1_500_000_000
BATCH_SIZE = 5000


def _positive_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _text(value, max_length):
    return str(value or "")[:max_length]


def _link_batch(Anime, pending):
    """Fill ``to_anime_id`` on a batch of (relation, slug) pairs with three lookups."""
    anilist_ids = {rel.target_anilist_id for rel, _ in pending if rel.target_anilist_id}
    mal_ids = {rel.target_mal_id for rel, _ in pending if rel.target_mal_id}
    slugs = {slug for _, slug in pending if slug}
    by_anilist = dict(
        Anime.objects.filter(anilist_id__in=anilist_ids).values_list("anilist_id", "id")
    )
    by_mal = dict(Anime.objects.filter(mal_id__in=mal_ids).values_list("mal_id", "id"))
    by_slug = dict(Anime.objects.filter(slug__in=slugs).values_list("slug", "id"))
    for rel, slug in pending:
        rel.to_anime_id = (
            by_anilist.get(rel.target_anilist_id)
            or by_mal.get(rel.target_mal_id)
            or by_slug.get(slug)
        )


def copy_json_relations(apps, schema_editor):
    Anime = apps.get_model("anime", "Anime")
    AnimeRelation = apps.get_model("anime", "AnimeRelation")

    pending = []

    def flush():
        _link_batch(Anime, pending)
        AnimeRelation.objects.bulk_create(rel for rel, _ in pending)
        pending.clear()

    rows = (
        Anime.objects.exclude(relations_json=[])
        .values_list("id", "relations_json")
        .order_by("id")
        .iterator(chunk_size=2000)
    )
    for anime_id, entries in rows:
        if not isinstance(entries, list):
            continue
        seen = set()
        position = 0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            anilist_id = _positive_int(entry.get("id"))
            mal_id = _positive_int(entry.get("mal_id"))
            if anilist_id and anilist_id >= LEGACY_JIKAN_ANILIST_ID_OFFSET:
                mal_id = mal_id or _positive_int(anilist_id - LEGACY_JIKAN_ANILIST_ID_OFFSET)
                anilist_id = None
            keys = {key for key in (("anilist", anilist_id), ("mal", mal_id)) if key[1]}
            if keys & seen:
                continue
            seen |= keys
            relation = AnimeRelation(
                from_anime_id=anime_id,
                relation_type=_text(entry.get("type"), 32),
                target_anilist_id=anilist_id,
                target_mal_id=mal_id,
                title=_text(entry.get("title"), 500),
                format=_text(entry.get("format"), 32),
                status=_text(entry.get("status"), 32),
                cover=_text(entry.get("cover"), 1000),
                position=position,
            )
            pending.append((relation, entry.get("slug") or None))
            position += 1
        if len(pending) >= BATCH_SIZE:
            flush()
    if pending:
        flush()


def restore_json_relations(apps, schema_editor):
    Anime = apps.get_model("anime", "Anime")
    AnimeRelation = apps.get_model("anime", "AnimeRelation")

    by_anime = {}
    relations = AnimeRelation.objects.order_by("from_anime_id", "position", "id").values(
        "from_anime_id",
        "relation_type",
        "target_anilist_id",
        "target_mal_id",
        "title",
        "format",
        "status",
        "cover",
        "to_anime__slug",
    )
    for rel in relations.iterator(chunk_size=5000):
        by_anime.setdefault(rel["from_anime_id"], []).append(
            {
                "id": rel["target_anilist_id"],
                "mal_id": rel["target_mal_id"],
                "type": rel["relation_type"],
                "title": rel["title"],
                "format": rel["format"] or None,
                "status": rel["status"] or None,
                "cover": rel["cover"],
                "slug": rel["to_anime__slug"],
            }
        )
    for anime_id, entries in by_anime.items():
        Anime.objects.filter(id=anime_id).update(relations_json=entries)


class Migration(migrations.Migration):
    dependencies = [
        ("anime", "0048_anime_data_model_cleanup"),
    ]

    operations = [
        migrations.RenameField(
            model_name="anime",
            old_name="relations",
            new_name="relations_json",
        ),
        migrations.CreateModel(
            name="AnimeRelation",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("relation_type", models.CharField(blank=True, max_length=32)),
                ("target_anilist_id", models.IntegerField(blank=True, null=True)),
                ("target_mal_id", models.IntegerField(blank=True, null=True)),
                ("title", models.CharField(blank=True, max_length=500)),
                ("format", models.CharField(blank=True, max_length=32)),
                ("status", models.CharField(blank=True, max_length=32)),
                ("cover", models.URLField(blank=True, max_length=1000)),
                ("position", models.PositiveSmallIntegerField(default=0)),
                (
                    "from_anime",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="relations",
                        to="anime.anime",
                    ),
                ),
                (
                    "to_anime",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="incoming_relations",
                        to="anime.anime",
                    ),
                ),
            ],
            options={
                "ordering": ["position", "id"],
                "indexes": [
                    models.Index(fields=["target_anilist_id"], name="anime_relation_anilist_idx"),
                    models.Index(fields=["target_mal_id"], name="anime_relation_mal_idx"),
                ],
            },
        ),
        migrations.RunPython(copy_json_relations, restore_json_relations),
    ]
