"""What the providers write: anime rows, people, theme songs, relations, media.

Payloads come from the recorded fixtures (Jikan through ``httpx.MockTransport``,
AniList fed to the methods that parse its responses). Calls go through
``resolve`` so these tests hold for the async and the sync provider API.
"""

from __future__ import annotations

import io
import json

import pytest
from django.core.files.storage import FileSystemStorage
from PIL import Image

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeStaff,
    Character,
    Staff,
    ThemeSong,
)
from apps.animes.services.anilist import AniListService
from apps.animes.services.jikan import JikanService, get_jikan_base_url
from apps.animes.tests.provider_testing import (
    JIKAN_ROUTES,
    ProviderHTTP,
    fake_method,
    load_fixture,
    resolve,
    styled_like,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def local_image_storage(monkeypatch, tmp_path):
    """Store image fields on disk (the model pins them to object storage)."""
    storage = FileSystemStorage(location=tmp_path)
    for field in ("cover_image", "banner_image"):
        monkeypatch.setattr(Anime._meta.get_field(field), "storage", storage)
    return storage


@pytest.fixture(autouse=True)
def queued_image_fetches(monkeypatch):
    monkeypatch.setattr("apps.animes.signals.enrich_metadata.delay", lambda *a, **k: None)
    calls = []
    monkeypatch.setattr(
        "apps.animes.tasks.images._queue_image_fetch", lambda **kwargs: calls.append(kwargs)
    )
    return calls


def jpeg_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="JPEG")
    return buffer.getvalue()


def media_fixture():
    return load_fixture("anilist/media_154587.json")["Media"]


def trending_fixture():
    return load_fixture("anilist/page_trending.json")["Page"]["media"]


def make_anime(**fields):
    defaults = {
        "synopsis": "stored synopsis",
        "anime_type": Anime.AnimeType.tv,
        "status": Anime.AnimeStatus.finished,
    }
    defaults.update(fields)
    defaults.setdefault("slug", fields["title"].lower().replace(" ", "-"))
    return Anime.objects.create(**defaults)


# ---------------------------------------------------------------- AniList


@pytest.fixture
def anilist():
    service = AniListService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


def anilist_answers(service, responses: dict):
    """Serve ``_query`` from ``responses`` keyed by GraphQL operation name."""

    def query(query, variables, *args, **kwargs):
        service._reset_last_error()
        for name, payload in responses.items():
            if f"query {name}(" in query:
                return json.loads(json.dumps(payload))
        return {}

    fake_method(service, "_query", query)


class TestAniListPersistence:
    def test_process_media_list_creates_then_updates(self, anilist, queued_image_fetches):
        broken = {"id": 999, "title": {"english": "Broken Genres"}, "genres": 5}
        items = [*trending_fixture(), media_fixture(), broken]
        progress = []
        callback = styled_like(AniListService.process_media_list, progress.append)

        stats = resolve(anilist.process_media_list(items, progress_callback=callback))

        assert (stats["created"], stats["updated"], stats["skipped"]) == (4, 0, 1)
        assert len(stats["created_anime_ids"]) == 4
        assert progress == [1, 3, 4, 5]

        frieren = Anime.objects.get(anilist_id=154587)
        assert frieren.slug == "frieren-beyond-journeys-end"
        assert frieren.mal_id == 52991
        assert sorted(frieren.genres.values_list("name", flat=True)) == [
            "Adventure",
            "Drama",
            "Fantasy",
        ]
        assert list(frieren.studios.values_list("name", flat=True)) == ["MADHOUSE"]
        assert frieren.trailer_url == "https://www.youtube.com/watch?v=qgQoQ3cDkq4"
        assert AnimeCharacter.objects.filter(anime=frieren).count() == 3
        assert AnimeStaff.objects.filter(anime=frieren).count() == 2
        assert Character.objects.get(anilist_id=176754).name_native == "フリーレン"
        assert Character.objects.get(name="Village Elder").anilist_id is None
        assert Staff.objects.filter(name="Unknown Seiyuu", anilist_id__isnull=True).exists()
        assert list(frieren.relations.values_list("target_anilist_id", "relation_type")) == [
            (182255, "SEQUEL")
        ]

        songs = list(
            ThemeSong.objects.filter(anime=frieren)
            .order_by("song_type", "track_number")
            .values_list("song_type", "track_number", "title", "artist", "episodes")
        )
        assert songs == [
            ("ending", 1, "Anytime Anywhere", "milet", "1-27"),
            ("ending", 2, "Untitled Ending", "", ""),
            ("opening", 1, "Yuusha", "YOASOBI", "1-16"),
            ("opening", 2, "Haru", "Yorushika", "17-28"),
            ("opening", 4, "Plain Song", "Someone", ""),
        ]

        dandadan = Anime.objects.get(anilist_id=171018)
        assert dandadan.trailer_url == "https://www.dailymotion.com/video/x5n_ZVRWGTw"
        assert dandadan.next_airing_episode == 8
        assert Anime.objects.get(anilist_id=21).trailer_url in ("", None)
        assert {call["anime_id"] for call in queued_image_fetches} >= {frieren.id, dandadan.id}

        # A second run updates in place and keeps the slugs.
        again = resolve(anilist.process_media_list(items))
        assert (again["created"], again["updated"], again["skipped"]) == (0, 4, 1)
        frieren.refresh_from_db()
        assert frieren.slug == "frieren-beyond-journeys-end"
        assert ThemeSong.objects.filter(anime=frieren).count() == 5

    def test_update_anime_manual_preserves_slug(self, anilist):
        anime = make_anime(title="Frieren", slug="frieren-local", anilist_id=154587)

        assert resolve(anilist.update_anime_manual(anime, media_fixture())) is True

        anime.refresh_from_db()
        assert anime.slug == "frieren-local"
        assert anime.title == media_fixture()["title"]["english"]
        assert anime.episode_count == 28
        assert AnimeCharacter.objects.filter(anime=anime).count() == 3

    def test_update_anime_manual_refetches_on_anilist_id_mismatch(self, anilist):
        anime = make_anime(title="Other", anilist_id=777)
        anilist_answers(anilist, {})

        assert resolve(anilist.update_anime_manual(anime, media_fixture())) is False
        anime.refresh_from_db()
        assert anime.title == "Other"

    def test_update_anime_manual_refetches_by_mal_id_on_mal_mismatch(self, anilist):
        anime = make_anime(title="Frieren", mal_id=52991)
        canonical = media_fixture()
        anilist_answers(anilist, {"SearchByMalId": {"Media": canonical}})

        assert resolve(anilist.update_anime_manual(anime, {**canonical, "idMal": 1})) is True
        anime.refresh_from_db()
        assert anime.anilist_id == 154587

    @pytest.mark.parametrize("field", ["anilist_id", "mal_id"])
    def test_update_anime_manual_skips_identities_owned_by_another_row(self, anilist, field):
        make_anime(title="Owner", **{field: 154587 if field == "anilist_id" else 52991})
        anime = make_anime(title="Target")

        assert resolve(anilist.update_anime_manual(anime, media_fixture())) is False
        anime.refresh_from_db()
        assert anime.title == "Target"

    def test_update_anime_manual_reraises_errors(self, anilist):
        anime = make_anime(title="Target")
        with pytest.raises(TypeError):
            resolve(anilist.update_anime_manual(anime, {"title": {"english": "X"}, "genres": 5}))

    def test_save_anime_to_db_matches_by_ids_then_slug(self, anilist):
        media = media_fixture()

        created = anilist.save_anime_to_db(media)
        assert (created.anilist_id, created.mal_id) == (154587, 52991)
        assert created.release_date.isoformat() == "2023-09-29"

        updated = anilist.save_anime_to_db({**media, "description": "<b>New</b> synopsis"})
        assert updated.id == created.id
        updated.refresh_from_db()
        assert updated.synopsis == "New synopsis"

        by_mal = anilist.save_anime_to_db({**media, "id": None})
        assert by_mal.id == created.id

        slug_row = make_anime(title="No Ids Show")
        by_slug = anilist.save_anime_to_db({"title": {"english": "No Ids Show"}})
        assert by_slug.id == slug_row.id

        # A different show with the same title gets its own, year-suffixed slug.
        remake = anilist.save_anime_to_db(
            {"id": 5, "idMal": 6, "title": {"english": "No Ids Show"}, "seasonYear": 2030}
        )
        assert remake.id != slug_row.id
        assert remake.slug.startswith("no-ids-show-")

        with pytest.raises(ValueError, match="title"):
            anilist.save_anime_to_db({"id": 7, "title": {}})

    def test_resolve_media_for_anime(self, anilist):
        media = media_fixture()
        anilist_answers(
            anilist,
            {
                "GetAnimeById": {"Media": media},
                "SearchByMalId": {"Media": media},
                "SearchAnime": {"Page": {"media": [{**media, "id": 1}, media]}},
            },
        )

        by_id = make_anime(title="A", anilist_id=154587)
        assert resolve(anilist.resolve_media_for_anime(by_id))["id"] == 154587

        by_mal = make_anime(title="B", mal_id=52991)
        assert resolve(anilist.resolve_media_for_anime(by_mal))["idMal"] == 52991

        by_title = make_anime(title="Sousou no Frieren", title_jp="葬送のフリーレン")
        assert resolve(anilist.resolve_media_for_anime(by_title))["id"] == 1

        untitled = Anime(title="  ")
        assert resolve(anilist.resolve_media_for_anime(untitled)) is None
        assert anilist.last_error_message == "missing_title"

        nothing = make_anime(title="Unmatched Title")
        assert resolve(anilist.resolve_media_for_anime(nothing)) is None
        assert anilist.last_error_message == "title:Unmatched Title"

    def test_resolve_media_for_anime_keeps_identity_when_searching(self, anilist):
        media = media_fixture()
        anilist_answers(
            anilist,
            {"SearchAnime": {"Page": {"media": [{**media, "id": 9, "idMal": 9}, media]}}},
        )
        anime = Anime(title="Someone Else", anilist_id=154587, mal_id=52991)

        # Lookups by ID find nothing, the title matches nothing, but an ID does.
        assert resolve(anilist.resolve_media_for_anime(anime))["id"] == 154587

        anilist_answers(anilist, {})
        assert resolve(anilist.resolve_media_for_anime(anime)) is None

    def test_media_helpers_write_trailer_and_external_urls(self, anilist):
        anime = make_anime(title="Media Row")

        resolve(anilist._save_trailer_url(anime, "https://www.youtube.com/watch?v=x"))
        resolve(
            anilist._save_external_url(
                anime, "cover_image_external_url", "http://s4.anilist.co/a.jpg"
            )
        )
        anime.refresh_from_db()
        assert anime.trailer_url == "https://www.youtube.com/watch?v=x"
        assert anime.cover_image_external_url == "https://s4.anilist.co/a.jpg"

    def test_save_image_stores_the_file_and_queues_thumbnails(
        self, anilist, monkeypatch, local_image_storage
    ):
        queued = []
        monkeypatch.setattr(
            "apps.animes.tasks.generate_image_thumbnails.delay",
            lambda anime_id: queued.append(anime_id),
        )
        anime = make_anime(title="Image Row")
        resolve(anilist._save_image(anime, "cover_image", "image-row.jpg", jpeg_bytes()))
        anime.refresh_from_db()
        assert local_image_storage.exists(anime.cover_image.name)
        assert queued == [anime.id]


# ---------------------------------------------------------------- Jikan


@pytest.fixture
def jikan_http(monkeypatch):
    return ProviderHTTP(JIKAN_ROUTES, base_url=get_jikan_base_url()).install(monkeypatch)


@pytest.fixture
def jikan(jikan_http):
    service = JikanService(enable_caching=False, enable_rate_limiting=False)
    yield service
    resolve(service.close())


class TestJikanPersistence:
    def test_save_anime_to_db_writes_the_full_payload(self, jikan, queued_image_fetches):
        media = resolve(jikan.search_by_mal_id(52991))

        anime = jikan.save_anime_to_db(media)

        assert (anime.mal_id, anime.anilist_id) == (52991, None)
        assert anime.slug == "frieren-beyond-journeys-end"
        assert anime.provider_ids == {"myanimelist": 52991, "jikan": 52991}
        assert anime.trailer_url == "https://www.youtube.com/watch?v=qgQoQ3cDkq4"
        assert list(anime.studios.values_list("name", flat=True)) == ["Madhouse"]
        assert anime.genres.count() == 3
        assert sorted(anime.relations.values_list("target_mal_id", flat=True)) == [56885, 59978]

        assert AnimeCharacter.objects.filter(anime=anime).count() == 3
        frieren = AnimeCharacter.objects.get(anime=anime, character__name="Frieren")
        assert frieren.role == AnimeCharacter.Role.MAIN
        assert frieren.voice_actor.name == "Tanezaki, Atsumi"
        assert (
            AnimeCharacter.objects.get(anime=anime, character__name="Village Elder").voice_actor
            is None
        )
        assert sorted(AnimeStaff.objects.filter(anime=anime).values_list("role", flat=True)) == [
            "Director",
            "Episode Director",
            "Series Composition",
            "Staff",
            "Storyboard",
        ]
        assert Staff.objects.get(name="Overflow, Person").anilist_id is None
        assert sorted(
            ThemeSong.objects.filter(anime=anime).values_list("song_type", "track_number")
        ) == [
            ("ending", 1),
            ("ending", 2),
            ("opening", 1),
            ("opening", 2),
        ]
        assert queued_image_fetches and queued_image_fetches[0]["mal_id"] == 52991

    def test_save_anime_to_db_updates_without_clearing_the_schedule(self, jikan):
        media = resolve(jikan.search_by_mal_id(52991))
        anime = jikan.save_anime_to_db(media)
        Anime.objects.filter(pk=anime.pk).update(next_airing_episode=29)

        again = jikan.save_anime_to_db({**media, "description": "Updated synopsis."})

        assert again.id == anime.id
        again.refresh_from_db()
        assert again.synopsis == "Updated synopsis."
        # Jikan has no schedule for this show; silence must not clear the stored one.
        assert again.next_airing_episode == 29

    @pytest.mark.parametrize(
        "row",
        [
            {"provider_ids": {"myanimelist": 52991}},
            {"provider_ids": {"jikan": 52991}},
            {"provider_ids": {"anilist": 154587}},
        ],
    )
    def test_save_anime_to_db_matches_provider_ids(self, jikan, row):
        existing = make_anime(title="Provider Match", **row)
        media = {**resolve(jikan.search_by_mal_id(52991)), "id": 154587}

        assert jikan.save_anime_to_db(media).id == existing.id

    def test_save_anime_to_db_matches_custom_provider_ids_and_requires_a_title(self, jikan):
        existing = make_anime(title="Kitsu Row", provider_ids={"kitsu": 42})
        payload = {"title": {"romaji": "Kitsu Row"}, "providerIds": {"kitsu": 42, "empty": ""}}

        assert jikan.save_anime_to_db(payload).id == existing.id
        with pytest.raises(ValueError, match="title"):
            jikan.save_anime_to_db({"idMal": 1, "title": {}})

    def test_refresh_and_manual_update(self, jikan):
        anime = make_anime(title="Frieren", mal_id=52991, anilist_id=154587, season_year=2023)

        assert resolve(jikan.refresh_anime_metadata(anime)) is True
        anime.refresh_from_db()
        assert anime.episode_count == 28
        assert AnimeStaff.objects.filter(anime=anime).count() == 5

        anime.episode_count = 1
        anime.save()
        assert resolve(jikan.update_anime_manual(anime)) is True
        anime.refresh_from_db()
        assert anime.episode_count == 28

    def test_refresh_and_manual_update_skip_without_media(self, jikan):
        anime = make_anime(title="Nothing Like It", mal_id=404)

        assert resolve(jikan.refresh_anime_metadata(anime)) is False
        assert resolve(jikan.update_anime_manual(anime)) is False

    def test_resolve_by_title_requires_a_compatible_year(self, jikan):
        match = make_anime(title="Sousou no Frieren", season_year=2023, anilist_id=154587)
        resolved = resolve(jikan.resolve_media_for_anime(match))
        assert (resolved["idMal"], resolved["id"]) == (52991, 154587)

        remake = make_anime(title="Sousou no Frieren", slug="frieren-2050", season_year=2050)
        assert resolve(jikan.resolve_media_for_anime(remake)) is None
        assert jikan.last_error_message == "title:Sousou no Frieren"

        jikan._reset_last_error()
        assert resolve(jikan.resolve_media_for_anime(Anime(title=""))) is None
        assert jikan.last_error_message == "missing_title"

    def test_resolve_falls_back_to_title_search_for_a_known_mal_id(self, jikan):
        anime = make_anime(title="Sousou no Frieren: ●● no Mahou", mal_id=56885)

        resolved = resolve(jikan.resolve_media_for_anime(anime))

        assert resolved["idMal"] == 56885
        assert resolved["format"] == "ONA"

    def test_airing_resolver_prefers_the_light_payload(self, jikan, jikan_http):
        anime = make_anime(title="One Piece", mal_id=21, anilist_id=21)

        resolved = resolve(jikan.resolve_airing_media_for_anime(anime))

        assert (resolved["id"], resolved["idMal"], resolved["status"]) == (21, 21, "RELEASING")
        assert "GET /anime/21/characters" not in jikan_http.calls()

        no_mal = make_anime(title="Unknown Show")
        assert resolve(jikan.resolve_airing_media_for_anime(no_mal)) is None

    def test_lookups_by_anilist_id_use_the_local_mal_id(self, jikan):
        make_anime(title="Frieren", mal_id=52991, anilist_id=154587)
        make_anime(title="One Piece", mal_id=21, anilist_id=21)

        assert resolve(jikan.get_anime_by_id(154587))["idMal"] == 52991
        assert resolve(jikan.get_airing_anime_by_id(21))["idMal"] == 21
        streaming = resolve(jikan.get_streaming_episodes_for_anime(anilist_id=154587))
        assert streaming["idMal"] == 52991
        assert len(streaming["streamingEpisodes"]) == 3

        assert resolve(jikan.get_anime_by_id(1)) is None
        assert jikan.last_error_message == "anilist_id:1"
        assert resolve(jikan.get_airing_anime_by_id(1)) is None
        assert resolve(jikan.get_anime_by_id(0)) is None
        assert resolve(jikan.get_airing_anime_by_id(-1)) is None
        assert resolve(jikan.get_streaming_episodes_for_anime(anilist_id=1)) is None

    def test_lookups_by_anilist_id_report_missing_media(self, jikan):
        make_anime(title="Gone", mal_id=404, anilist_id=4040)

        assert resolve(jikan.get_anime_by_id(4040)) is None
        assert jikan.last_error_code == "not_found"
        assert resolve(jikan.get_airing_anime_by_id(4040)) is None

    def test_media_helpers(self, jikan, monkeypatch, local_image_storage):
        anime = make_anime(title="Helper Row")
        resolve(jikan._save_trailer_url(anime, "https://www.youtube.com/watch?v=y"))
        resolve(
            jikan._save_external_url(
                anime, "banner_image_external_url", "https://myanimelist.net/images/b.jpg"
            )
        )
        anime.refresh_from_db()
        assert anime.trailer_url == "https://www.youtube.com/watch?v=y"
        assert anime.banner_image_external_url == "https://cdn.myanimelist.net/images/b.jpg"

        queued = []
        monkeypatch.setattr(
            "apps.animes.tasks.generate_image_thumbnails.delay",
            lambda anime_id: queued.append(anime_id),
        )
        resolve(jikan._save_image(anime, "banner_image", "helper.jpg", jpeg_bytes()))
        anime.refresh_from_db()
        assert local_image_storage.exists(anime.banner_image.name)
        assert queued == [anime.id]
