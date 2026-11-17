"""What the AniList provider writes: anime rows, people, relations, media.

Payloads come from the recorded fixtures, fed to the methods that parse
AniList's responses (``_query`` is replaced). Calls go through ``resolve`` so
these tests hold for the async and the sync provider API.
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
from apps.animes.tests.provider_testing import (
    fake_method,
    load_fixture,
    operation_name,
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


def anilist_answers(service, responses: dict, *, error: str = "") -> list[tuple[str, dict]]:
    """Serve ``_query`` from ``responses`` keyed by GraphQL operation name.

    Unknown operations return ``{}`` with ``last_error_code`` set to ``error``
    (if given). Returns the list of (operation, variables) calls, kept up to date.
    """
    calls: list[tuple[str, dict]] = []

    def query(query, variables, *args, **kwargs):
        service._reset_last_error()
        name = operation_name(query)
        calls.append((name, dict(variables)))
        if name in responses:
            return json.loads(json.dumps(responses[name]))
        if error:
            service._set_last_error(error, f"fake:{name}")
        return {}

    fake_method(service, "_query", query)
    return calls


class TestAniListPersistence:
    def test_process_media_list_creates_then_updates(self, anilist, queued_image_fetches):
        broken = {"id": 999, "title": {"english": "Broken Genres"}, "genres": 5}
        items = [*trending_fixture(), media_fixture(), broken]
        progress: list[int] = []
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

        # AniList has no theme songs: payload "openings"/"endings" keys are ignored.
        assert not ThemeSong.objects.filter(anime=frieren).exists()

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
        assert AnimeCharacter.objects.filter(anime=frieren).count() == 3

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
                "SearchAnime": {
                    "Page": {"media": [{**media, "id": 1}, {**media, "seasonYear": 2040}]}
                },
            },
        )

        by_id = make_anime(title="A", anilist_id=154587)
        assert resolve(anilist.resolve_media_for_anime(by_id))["id"] == 154587

        by_mal = make_anime(title="B", mal_id=52991)
        assert resolve(anilist.resolve_media_for_anime(by_mal))["idMal"] == 52991

        # Without IDs, a title match must also be from about the same year.
        by_title = make_anime(
            title="Sousou no Frieren", title_jp="葬送のフリーレン", season_year=2023
        )
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


# ---------------------------------------------------------------- AniList: save, refresh, airing


class TestSaveAndRefresh:
    def test_save_anime_to_db_writes_the_full_payload(self, anilist, queued_image_fetches):
        anime = anilist.save_anime_to_db(media_fixture())

        assert (anime.anilist_id, anime.mal_id) == (154587, 52991)
        assert anime.slug == "frieren-beyond-journeys-end"
        assert anime.trailer_url == "https://www.youtube.com/watch?v=qgQoQ3cDkq4"
        assert anime.genres.count() == 3
        assert list(anime.relations.values_list("target_anilist_id", flat=True)) == [182255]
        # The save path stores the cast too, as the refresh path does.
        assert AnimeCharacter.objects.filter(anime=anime).count() == 3
        assert AnimeStaff.objects.filter(anime=anime).count() == 2
        assert queued_image_fetches
        assert all("mal_id" not in call for call in queued_image_fetches)

    def test_anilist_silence_on_the_schedule_clears_it(self, anilist):
        media = {**media_fixture(), "nextAiringEpisode": {"episode": 30, "airingAt": 1900000000}}
        anime = anilist.save_anime_to_db(media)
        assert anime.next_airing_episode == 30

        again = anilist.save_anime_to_db({**media, "nextAiringEpisode": None})

        again.refresh_from_db()
        # AniList is authoritative: no next episode means the show stopped airing.
        assert (again.next_airing_episode, again.next_airing_date) == (None, None)

    def test_unknown_values_keep_what_is_stored(self, anilist):
        anime = anilist.save_anime_to_db(media_fixture())
        anime.refresh_from_db()
        stored_synopsis = anime.synopsis

        anilist.save_anime_to_db({**media_fixture(), "description": "", "episodes": None})

        anime.refresh_from_db()
        assert anime.episode_count == 28
        assert anime.synopsis == stored_synopsis

    # The offline-catalog import copies its IDs onto these columns.
    @pytest.mark.parametrize("row", [{"anilist_id": 154587}, {"mal_id": 52991}])
    def test_save_anime_to_db_matches_offline_catalog_ids(self, anilist, row):
        existing = make_anime(title="Provider Match", **row)

        saved = anilist.save_anime_to_db(media_fixture())

        assert saved.id == existing.id
        saved.refresh_from_db()
        assert (saved.anilist_id, saved.mal_id) == (154587, 52991)

    def test_refresh_anime_metadata_resolves_then_applies(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587, season_year=2023)
        calls = anilist_answers(anilist, {"GetAnimeById": {"Media": media_fixture()}})

        assert resolve(anilist.refresh_anime_metadata(anime)) is True

        anime.refresh_from_db()
        assert anime.episode_count == 28
        assert anime.mal_id == 52991
        assert AnimeStaff.objects.filter(anime=anime).count() == 2
        assert calls == [("GetAnimeById", {"id": 154587})]

    def test_refresh_anime_metadata_without_media(self, anilist):
        anime = make_anime(title="Nothing Like It", anilist_id=404)
        anilist_answers(anilist, {})

        assert resolve(anilist.refresh_anime_metadata(anime)) is False

    def test_refresh_with_a_given_payload_makes_no_request(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)
        calls = anilist_answers(anilist, {})

        assert resolve(anilist.refresh_anime_metadata(anime, media_fixture())) is True
        assert calls == []


class TestAiringUpdates:
    def airing_payload(self, **fields):
        return {
            "id": 21,
            "idMal": 21,
            "title": {"romaji": "One Piece", "english": "ONE PIECE"},
            "format": "TV",
            "status": "RELEASING",
            "episodes": None,
            "nextAiringEpisode": {"episode": 1181, "airingAt": 1798985760},
            **fields,
        }

    def test_update_airing_fields_writes_schedule_only(self, anilist, queued_image_fetches):
        anime = make_anime(
            title="One Piece", slug="one-piece", anilist_id=21, mal_id=21, episode_count=1100
        )
        anime.genres.create(name="Action", slug="action")

        assert anilist.update_airing_fields(anime, self.airing_payload()) is True

        anime.refresh_from_db()
        assert anime.slug == "one-piece"
        assert anime.status == Anime.AnimeStatus.airing
        assert anime.next_airing_episode == 1181
        assert (anime.broadcast_day, anime.broadcast_timezone) == ("Sunday", "Asia/Tokyo")
        assert anime.broadcast_time.strftime("%H:%M") == "23:16"
        # Unknown here, so the stored values stay; nothing heavier ran.
        assert anime.episode_count == 1100
        assert anime.synopsis == "stored synopsis"
        assert anime.genres.count() == 1
        assert queued_image_fetches == []

    def test_update_airing_fields_refuses_another_identity(self, anilist):
        anime = make_anime(title="One Piece", anilist_id=21)

        assert anilist.update_airing_fields(anime, self.airing_payload(id=22)) is False
        assert anilist.update_airing_fields(anime, {}) is False
        anime.refresh_from_db()
        assert anime.next_airing_episode is None

    def test_recent_airing_transition_is_recorded(self, anilist):
        from datetime import timedelta

        from django.utils import timezone

        aired = timezone.now() - timedelta(hours=1)
        anime = make_anime(
            title="One Piece",
            anilist_id=21,
            status=Anime.AnimeStatus.airing,
            next_airing_episode=1180,
            next_airing_date=aired,
        )

        anilist.update_airing_fields(anime, self.airing_payload())

        anime.refresh_from_db()
        assert (anime.last_aired_episode, anime.last_aired_at) == (1180, aired)
        assert anime.next_airing_episode == 1181

    def test_prefetch_answers_the_resolver_without_more_requests(self, anilist):
        one_piece = make_anime(title="One Piece", anilist_id=21, mal_id=21)
        mal_only = make_anime(title="Mal Only", mal_id=500)
        calls = anilist_answers(
            anilist,
            {
                "GetAiringByIds": {
                    "Page": {"media": [self.airing_payload(), self.airing_payload(id=9, idMal=500)]}
                }
            },
        )

        assert anilist.prefetch_airing([one_piece, mal_only]) == 4

        assert [name for name, _ in calls] == ["GetAiringByIds", "GetAiringByIds"]
        assert calls[0][1]["ids"] == [21]
        assert calls[1][1]["ids"] == [500]
        assert anilist.resolve_airing_media_for_anime(one_piece)["id"] == 21
        assert anilist.resolve_airing_media_for_anime(mal_only)["idMal"] == 500
        assert len(calls) == 2

    def test_resolver_fetches_what_was_not_prefetched(self, anilist):
        anime = make_anime(title="One Piece", anilist_id=21)
        calls = anilist_answers(anilist, {"GetAiringAnime": {"Media": self.airing_payload()}})

        assert anilist.resolve_airing_media_for_anime(anime)["id"] == 21
        assert calls == [("GetAiringAnime", {"id": 21})]

    def test_resolver_stops_on_transient_errors(self, anilist):
        anime = make_anime(title="One Piece", anilist_id=21)
        calls = anilist_answers(anilist, {}, error="rate_limited")

        assert anilist.resolve_airing_media_for_anime(anime) is None
        # No fallback title search while AniList is throttling us.
        assert [name for name, _ in calls] == ["GetAiringAnime"]

    def test_resolver_falls_back_to_a_full_resolve(self, anilist):
        anime = make_anime(title="Sousou no Frieren", season_year=2023)
        anilist_answers(anilist, {"SearchAnime": {"Page": {"media": [media_fixture()]}}})

        assert anilist.resolve_airing_media_for_anime(anime)["id"] == 154587


class TestResolveByTitle:
    def test_title_match_requires_a_compatible_year(self, anilist):
        anilist_answers(anilist, {"SearchAnime": {"Page": {"media": [media_fixture()]}}})

        match = make_anime(title="Sousou no Frieren", season_year=2023)
        assert resolve(anilist.resolve_media_for_anime(match))["id"] == 154587

        remake = make_anime(title="Sousou no Frieren", slug="frieren-2050", season_year=2050)
        assert resolve(anilist.resolve_media_for_anime(remake)) is None
        assert anilist.last_error_message == "title:Sousou no Frieren"

    def test_several_title_matches_are_ambiguous_without_ids(self, anilist):
        media = media_fixture()
        anilist_answers(
            anilist, {"SearchAnime": {"Page": {"media": [media, {**media, "id": 2, "idMal": 3}]}}}
        )
        anime = make_anime(title="Sousou no Frieren")

        assert resolve(anilist.resolve_media_for_anime(anime)) is None
        assert anilist.last_error_message == "ambiguous_title:Sousou no Frieren"

    def test_transient_id_lookup_errors_skip_the_title_search(self, anilist):
        anime = make_anime(title="Sousou no Frieren", anilist_id=154587)
        calls = anilist_answers(anilist, {}, error="transport_error")

        assert resolve(anilist.resolve_media_for_anime(anime)) is None
        assert [name for name, _ in calls] == ["GetAnimeById"]


class TestCastReplacement:
    """AniList payloads carry a 10-person preview; stored casts beyond it must survive."""

    def test_links_outside_the_preview_are_kept(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)
        for index in range(1, 13):
            character = Character.objects.create(name=f"Extra {index}", anilist_id=900_000 + index)
            AnimeCharacter.objects.create(
                anime=anime, character=character, role=AnimeCharacter.Role.BACKGROUND
            )
            staff = Staff.objects.create(name=f"Animator {index}", anilist_id=800_000 + index)
            AnimeStaff.objects.create(anime=anime, staff=staff, role="Key Animation")

        assert resolve(anilist.update_anime_manual(anime, media_fixture())) is True

        # 12 stored + 3 from the preview; nothing outside the preview is deleted.
        assert AnimeCharacter.objects.filter(anime=anime).count() == 15
        assert AnimeStaff.objects.filter(anime=anime).count() == 14

    def test_jikan_era_people_are_retired_when_anilist_brings_them_back(self, anilist):
        from django.contrib.auth import get_user_model

        from apps.animes.models import UserFavoriteCharacter, UserFavoriteStaff

        user_model = get_user_model()
        alice = user_model.objects.create_user(
            username="alice", email="a@example.com", password="x"
        )
        bob = user_model.objects.create_user(username="bob", email="b@example.com", password="x")
        anime = make_anime(title="Frieren", anilist_id=154587)
        # Written from Jikan: synthetic IDs (1.6e9/1.7e9 + MAL ID).
        old_frieren = Character.objects.create(name="Frieren", anilist_id=1_600_000_001)
        # Jikan (MyAnimeList) spelled people "Family, Given".
        old_seiyuu = Staff.objects.create(name="Tanezaki, Atsumi", anilist_id=1_700_000_001)
        old_director = Staff.objects.create(name="Saitou, Keiichirou", anilist_id=1_700_000_002)
        old_only = Character.objects.create(name="Fern", anilist_id=1_600_000_002)
        AnimeCharacter.objects.create(
            anime=anime, character=old_frieren, voice_actor=old_seiyuu, role="MAIN"
        )
        AnimeCharacter.objects.create(anime=anime, character=old_only, role="MAIN")
        # The preview lists only "Director"; the other credits must survive.
        for role in ("Director", "Storyboard", "Episode Director"):
            AnimeStaff.objects.create(anime=anime, staff=old_director, role=role)
        # Bob already favourited the AniList rows too: he must keep exactly one.
        new_frieren = Character.objects.create(name="Frieren", anilist_id=176754)
        UserFavoriteCharacter.objects.create(user=alice, character=old_frieren)
        UserFavoriteCharacter.objects.create(user=bob, character=old_frieren)
        UserFavoriteCharacter.objects.create(user=bob, character=new_frieren)
        UserFavoriteStaff.objects.create(user=alice, staff=old_seiyuu)
        UserFavoriteStaff.objects.create(user=alice, staff=old_director)
        UserFavoriteStaff.objects.create(user=bob, staff=old_seiyuu)
        new_seiyuu = Staff.objects.create(name="Atsumi Tanezaki", anilist_id=119331)
        UserFavoriteStaff.objects.create(user=bob, staff=new_seiyuu)

        assert resolve(anilist.update_anime_manual(anime, media_fixture())) is True

        names = list(
            AnimeCharacter.objects.filter(anime=anime).values_list(
                "character__name", "character__anilist_id"
            )
        )
        assert ("Frieren", 1_600_000_001) not in names
        assert ("Frieren", 176754) in names
        # Not in the preview: kept.
        assert ("Fern", 1_600_000_002) in names
        assert not AnimeStaff.objects.filter(staff=old_director).exists()
        assert set(
            AnimeStaff.objects.filter(anime=anime, staff__anilist_id=106297).values_list(
                "role", flat=True
            )
        ) == {"Director", "Storyboard", "Episode Director"}
        assert set(
            UserFavoriteCharacter.objects.values_list("user__username", "character__anilist_id")
        ) == {("alice", 176754), ("bob", 176754)}
        assert set(
            UserFavoriteStaff.objects.values_list("user__username", "staff__anilist_id")
        ) == {("alice", 119331), ("alice", 106297), ("bob", 119331)}
        # The old rows stay (nothing points at them now).
        assert Character.objects.filter(pk=old_frieren.pk).exists()

    def test_a_folded_voice_actor_moves_on_characters_outside_the_preview(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)
        old_seiyuu = Staff.objects.create(name="Tanezaki, Atsumi", anilist_id=1_700_000_001)
        old_frieren = Character.objects.create(name="Frieren", anilist_id=1_600_000_001)
        eleventh = Character.objects.create(name="Young Frieren", anilist_id=900_011)
        for character in (old_frieren, eleventh):
            AnimeCharacter.objects.create(
                anime=anime, character=character, voice_actor=old_seiyuu, role="SUPPORTING"
            )

        anilist.update_anime_manual(anime, media_fixture())

        # Not in the preview, so kept, but voiced by the AniList person now.
        link = AnimeCharacter.objects.get(anime=anime, character=eleventh)
        assert link.voice_actor.anilist_id == 119331
        assert not AnimeCharacter.objects.filter(voice_actor=old_seiyuu).exists()

    def test_a_recast_character_keeps_one_link_with_the_new_voice_actor(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)
        frieren = Character.objects.create(name="Frieren", anilist_id=176754)
        old_voice = Staff.objects.create(name="Someone Else", anilist_id=555)
        AnimeCharacter.objects.create(
            anime=anime, character=frieren, voice_actor=old_voice, role="MAIN"
        )

        anilist.update_anime_manual(anime, media_fixture())

        links = AnimeCharacter.objects.filter(anime=anime, character=frieren)
        assert list(links.values_list("voice_actor__anilist_id", flat=True)) == [119331]

    def test_staff_roles_only_accumulate(self, anilist):
        # The preview may show one of a person's several roles: keep the others.
        anime = make_anime(title="Frieren", anilist_id=154587)
        director = Staff.objects.create(name="Keiichirou Saitou", anilist_id=106297)
        AnimeStaff.objects.create(anime=anime, staff=director, role="Storyboard")

        anilist.update_anime_manual(anime, media_fixture())

        assert set(
            AnimeStaff.objects.filter(anime=anime, staff=director).values_list("role", flat=True)
        ) == {"Director", "Storyboard"}

    def test_payload_without_a_cast_keeps_the_stored_one(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)
        anilist.update_anime_manual(anime, media_fixture())
        media = {**media_fixture(), "characterPreview": None, "staffPreview": {"edges": []}}

        anilist.update_anime_manual(anime, media)

        assert AnimeCharacter.objects.filter(anime=anime).count() == 3
        assert AnimeStaff.objects.filter(anime=anime).count() == 2

    def test_refreshing_twice_keeps_one_copy(self, anilist):
        anime = make_anime(title="Frieren", anilist_id=154587)

        anilist.update_anime_manual(anime, media_fixture())
        anilist.update_anime_manual(anime, media_fixture())

        assert AnimeCharacter.objects.filter(anime=anime).count() == 3
        assert AnimeStaff.objects.filter(anime=anime).count() == 2
