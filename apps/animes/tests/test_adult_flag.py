"""``Anime.is_adult`` must always equal the old adult-content rule (D5).

The old rule ran on every public query as two ``NOT IN`` subqueries: an adult
genre slug, or ``tags ?| ADULT_TAGS``. ``old_rule_ids()`` below is that rule,
copied from the pre-D5 ``_exclude_adult_content``; every test changes genres or
tags in one of the ways the app does and then checks that the stored flags
match it exactly.
"""

import importlib
import json
import tempfile
from pathlib import Path

import pytest
from django.apps import apps as django_apps
from django.db import connection

from apps.animes.adult_content import (
    ADULT_GENRE_SLUGS,
    ADULT_TAGS,
    is_adult_content,
    refresh_adult_flags,
    tags_are_adult,
)
from apps.animes.models import Anime, Genre
from apps.animes.services.anilist import AniListService
from apps.animes.services.offline_catalog import OfflineCatalogImportService
from apps.animes.services.public_anime_service import AnimeQueryService
from apps.animes.tests.provider_testing import resolve

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_side_effect_tasks(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)


def old_rule_ids() -> set[int]:
    by_genre = Anime.objects.filter(genres__slug__in=ADULT_GENRE_SLUGS).values_list("pk", flat=True)
    by_tag = Anime.objects.filter(tags__has_any_keys=sorted(ADULT_TAGS)).values_list(
        "pk", flat=True
    )
    return set(by_genre) | set(by_tag)


def flagged_ids() -> set[int]:
    return set(Anime.objects.filter(is_adult=True).values_list("pk", flat=True))


def assert_flags_match_old_rule():
    assert flagged_ids() == old_rule_ids()


_counter = iter(range(1, 10_000))


def make_anime(**fields) -> Anime:
    number = next(_counter)
    return Anime.objects.create(
        title=fields.pop("title", f"Flag Anime {number}"),
        slug=fields.pop("slug", f"flag-anime-{number}"),
        synopsis="synopsis",
        **fields,
    )


@pytest.fixture
def genres():
    return {
        slug: Genre.objects.get_or_create(slug=slug, defaults={"name": slug.title()})[0]
        for slug in ("hentai", "erotica", "action", "hentai-adjacent")
    }


# ------------------------------------------------------------------ tags


@pytest.mark.parametrize("tag", sorted(ADULT_TAGS))
def test_every_adult_tag_flags_the_row(tag):
    anime = make_anime(tags=["drama", tag])
    assert anime.is_adult is True
    assert_flags_match_old_rule()


@pytest.mark.parametrize(
    "tags",
    [
        [],
        ["drama", "romance"],
        ["NSFW"],  # the rule is case-sensitive
        [" nsfw"],
        ["sexy", "sex-ed"],  # substrings do not count
        [["nsfw"]],  # nested values are not elements
        [1, None, True],
        {"other": "nsfw"},  # object values are not keys
        "drama",
        7,
    ],
)
def test_tags_that_the_old_rule_did_not_match(tags):
    anime = make_anime(tags=tags)
    assert anime.is_adult is False
    assert_flags_match_old_rule()


@pytest.mark.parametrize("tags", [{"nsfw": True}, "nsfw", ["drama", "sex toys"]])
def test_json_shapes_the_old_rule_matched(tags):
    # ``?|`` matches object keys and a bare string as well as array elements.
    anime = make_anime(tags=tags)
    assert anime.is_adult is True
    assert_flags_match_old_rule()


def test_saving_new_tags_updates_the_flag_both_ways():
    anime = make_anime(tags=["drama"])
    anime.tags = ["nsfw"]
    anime.save()
    assert_flags_match_old_rule()
    assert flagged_ids() == {anime.pk}

    anime.tags = ["drama"]
    anime.save(update_fields=["tags"])
    assert_flags_match_old_rule()
    assert flagged_ids() == set()


def test_tags_saved_with_update_fields_persist_the_flag():
    anime = make_anime(tags=["drama"])
    anime.tags = ["incest"]
    anime.save(update_fields=["tags"])
    anime.refresh_from_db()
    assert anime.is_adult is True
    assert_flags_match_old_rule()


def test_save_without_tags_in_update_fields_leaves_the_flag_alone():
    anime = make_anime(tags=["nsfw"])
    Anime.objects.filter(pk=anime.pk).update(tags=["drama"])  # bypasses save()
    anime.title = "Renamed"
    anime.save(update_fields=["title"])
    anime.refresh_from_db()
    assert anime.is_adult is True  # unchanged: tags were not part of this save


def test_dropping_adult_tags_keeps_the_flag_for_an_adult_genre(genres):
    anime = make_anime(tags=["nsfw"])
    anime.genres.add(genres["hentai"])
    anime.tags = ["drama"]
    anime.save()
    assert anime.is_adult is True
    assert_flags_match_old_rule()


def test_deferred_tags_do_not_touch_the_flag():
    anime = make_anime(tags=["nsfw"])
    loaded = Anime.objects.only("id", "title").get(pk=anime.pk)
    loaded.title = "Only title"
    loaded.save()
    assert_flags_match_old_rule()


# ---------------------------------------------------------------- genres


@pytest.mark.parametrize("slug", sorted(ADULT_GENRE_SLUGS))
def test_adding_an_adult_genre_flags_the_row(genres, slug):
    anime = make_anime()
    anime.genres.add(genres["action"], genres[slug])
    assert_flags_match_old_rule()
    assert flagged_ids() == {anime.pk}


def test_a_similar_genre_slug_is_not_adult(genres):
    anime = make_anime()
    anime.genres.add(genres["hentai-adjacent"])
    assert_flags_match_old_rule()
    assert flagged_ids() == set()


def test_removing_setting_and_clearing_genres(genres):
    anime = make_anime()
    anime.genres.add(genres["hentai"], genres["erotica"])
    anime.genres.remove(genres["hentai"])
    assert flagged_ids() == {anime.pk}  # still erotica
    anime.genres.set([genres["action"]])
    assert flagged_ids() == set()
    anime.genres.set([genres["erotica"]])
    assert flagged_ids() == {anime.pk}
    anime.genres.clear()
    assert flagged_ids() == set()
    assert_flags_match_old_rule()


def test_reverse_side_add_remove_and_clear(genres):
    first, second, other = make_anime(), make_anime(), make_anime(tags=["nsfw"])
    genres["hentai"].anime.add(first, second, other)
    assert flagged_ids() == {first.pk, second.pk, other.pk}
    genres["hentai"].anime.remove(first)
    assert flagged_ids() == {second.pk, other.pk}
    genres["hentai"].anime.clear()
    assert flagged_ids() == {other.pk}  # its tag still makes it adult
    genres["action"].anime.add(first)
    assert_flags_match_old_rule()


def test_renaming_a_genre_slug_to_and_from_adult(genres):
    anime = make_anime()
    anime.genres.add(genres["action"])
    genre = genres["action"]
    genre.slug = "hentai-renamed"
    genre.save()
    assert flagged_ids() == set()

    genres["hentai"].slug = "hentai-old"
    genres["hentai"].save()
    genre.slug = "hentai"
    genre.save()
    assert flagged_ids() == {anime.pk}

    genre.slug = "action"
    genre.save()
    assert flagged_ids() == set()
    assert_flags_match_old_rule()


def test_deleting_an_adult_genre_clears_its_flags(genres):
    adult_by_genre, adult_by_tag = make_anime(), make_anime(tags=["rape"])
    genres["erotica"].anime.add(adult_by_genre, adult_by_tag)
    genres["erotica"].delete()
    assert flagged_ids() == {adult_by_tag.pk}
    assert_flags_match_old_rule()


# --------------------------------------------------- write paths and reads


def test_provider_payload_marks_adult_rows():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    try:
        adult_by_genre = service._prepare_anime_data(
            {"genres": ["Hentai"], "tags": []}, "A", "", "a"
        )
        adult_by_tag = service._prepare_anime_data(
            {"genres": ["Drama"], "tags": [{"name": "  NSFW "}]}, "B", "", "b"
        )
        plain = service._prepare_anime_data({"genres": ["Drama"], "tags": []}, "C", "", "c")
        broken = service._prepare_anime_data({"genres": 5}, "D", "", "d")
    finally:
        resolve(service.close())
    assert adult_by_genre["is_adult"] is True
    assert adult_by_tag["is_adult"] is True
    # Not proof of "not adult": the key is left out so updates keep the stored flag.
    assert "is_adult" not in plain
    assert "is_adult" not in broken


def test_provider_create_and_update_paths(genres):
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    item = {
        "id": 777001,
        "title": {"english": "Provider Adult Show"},
        "genres": ["Hentai"],
        "tags": [],
        "format": "OVA",
        "status": "FINISHED",
    }
    try:
        anime = service.save_anime_to_db(item)
        assert_flags_match_old_rule()
        assert flagged_ids() == {anime.pk}

        # A later payload without the genre: genres only accumulate, so the
        # stored hentai link (and the flag) stay, as with the old rule.
        service.save_anime_to_db({**item, "genres": ["Drama"]})
        assert_flags_match_old_rule()
        assert flagged_ids() == {anime.pk}

        # Explicit tags on another show flag it through the same path.
        tagged = service.save_anime_to_db(
            {
                **item,
                "id": 777002,
                "title": {"english": "Tagged"},
                "genres": ["Drama"],
                "tags": [{"name": "Incest"}],
            }
        )
        assert flagged_ids() == {anime.pk, tagged.pk}
        assert_flags_match_old_rule()
    finally:
        resolve(service.close())


def _offline_entry(**overrides):
    payload = {
        "sources": ["https://anilist.co/anime/880001", "https://myanimelist.net/anime/880001"],
        "title": "Offline Flag Show",
        "type": "TV",
        "episodes": 12,
        "status": "FINISHED",
        "animeSeason": {"season": "FALL", "year": 2006},
        "picture": "https://cdn.example.com/p.jpg",
        "thumbnail": "https://cdn.example.com/t.jpg",
        "duration": {"value": 1440, "unit": "SECONDS"},
        "score": {"arithmeticGeometricMean": 7.1},
        "synonyms": [],
        "studios": [],
        "producers": [],
        "relatedAnime": [],
        "tags": ["drama"],
    }
    payload.update(overrides)
    return payload


def _run_offline_import(*entries):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as handle:
        handle.write(json.dumps({"lastUpdate": "2026-03-23"}) + "\n")
        for entry in entries:
            handle.write(json.dumps(entry) + "\n")
    try:
        OfflineCatalogImportService(batch_size=10).run_import(
            source_path=handle.name, asset_name="anime-offline-database.jsonl"
        )
    finally:
        Path(handle.name).unlink(missing_ok=True)


def test_offline_import_creates_and_updates_flags():
    _run_offline_import(
        _offline_entry(),
        _offline_entry(
            title="Offline Explicit Show",
            sources=["https://anilist.co/anime/880002", "https://myanimelist.net/anime/880002"],
            tags=["drama", "NSFW", "nsfw"],  # deduped case-insensitively: "NSFW" is kept
        ),
    )
    assert_flags_match_old_rule()
    assert flagged_ids() == set()

    _run_offline_import(_offline_entry(tags=["drama", "netorare"]))
    assert_flags_match_old_rule()
    assert flagged_ids() == {Anime.objects.get(anilist_id=880001).pk}


def test_refresh_adult_flags_repairs_drifted_rows(genres):
    by_genre, by_tag, plain = make_anime(), make_anime(tags=["nsfw"]), make_anime()
    by_genre.genres.add(genres["hentai"])
    Anime.objects.update(is_adult=False)
    Anime.objects.filter(pk=plain.pk).update(is_adult=True)

    changed = refresh_adult_flags([by_genre.pk, by_tag.pk, plain.pk])

    assert changed == 3
    assert_flags_match_old_rule()
    assert refresh_adult_flags([by_genre.pk, by_tag.pk, plain.pk]) == 0


def test_backfill_migration_matches_the_old_rule(genres):
    by_genre, by_tag, both = make_anime(), make_anime(tags=["sex"]), make_anime(tags=["nsfw"])
    plain = make_anime(tags=["drama"])
    genres["erotica"].anime.add(by_genre, both)
    Anime.objects.update(is_adult=False)
    Anime.objects.filter(pk=plain.pk).update(is_adult=True)

    migration = importlib.import_module("apps.animes.migrations.0054_backfill_anime_is_adult")
    assert set(migration.ADULT_TAGS) == ADULT_TAGS
    assert set(migration.ADULT_GENRE_SLUGS) == ADULT_GENRE_SLUGS
    with connection.schema_editor() as schema_editor:
        migration.backfill_is_adult(django_apps, schema_editor)

    assert flagged_ids() == {by_genre.pk, by_tag.pk, both.pk}
    assert_flags_match_old_rule()


def test_public_list_hides_exactly_the_old_rule_rows(client, genres):
    visible = make_anime(title="Visible Show")
    hidden_genre, hidden_tag = make_anime(), make_anime(tags=["futanari"])
    hidden_genre.genres.add(genres["hentai"])

    response = client.get("/api/v1/anime/?page_size=50")

    ids = {item["id"] for item in response.json()["results"]}
    assert visible.pk in ids
    assert not ids & old_rule_ids()
    assert old_rule_ids() == {hidden_genre.pk, hidden_tag.pk}


def test_exclusion_is_a_plain_flag_filter():
    sql = str(AnimeQueryService._exclude_adult_content(Anime.objects.all()).query)
    assert '"anime_anime"."is_adult"' in sql
    assert "?|" not in sql and "IN (SELECT" not in sql


def test_python_rule_matches_the_tags_rule():
    assert is_adult_content(["hentai"], []) is True
    assert is_adult_content(["action"], ["nsfw"]) is True
    assert is_adult_content(None, None) is False
    assert tags_are_adult(None) is False
