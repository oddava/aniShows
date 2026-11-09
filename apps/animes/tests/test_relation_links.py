from django.test import TestCase

from ..models import Anime, AnimeRelation
from ..services.jikan import JikanService
from ..services.relation_links import (
    link_pending_relations,
    link_relations_to,
    set_relations,
    sync_relations_from_media,
)


def make_anime(slug: str, **fields) -> Anime:
    return Anime.objects.create(
        title=slug.replace("-", " ").title(),
        slug=slug,
        synopsis="",
        anime_type=Anime.AnimeType.tv,
        status=Anime.AnimeStatus.finished,
        **fields,
    )


def edge(relation_type: str, *, anilist_id=None, mal_id=None, title="Related", media_type="ANIME"):
    return {
        "relationType": relation_type,
        "node": {
            "id": anilist_id,
            "idMal": mal_id,
            "type": media_type,
            "title": {"english": title},
            "format": "TV",
            "status": "FINISHED",
            "coverImage": {"large": "https://img.anilist.co/cover.jpg"},
        },
    }


class SetRelationsTests(TestCase):
    def test_links_local_targets_keeps_order_and_drops_repeated_ids(self):
        source = make_anime("source", anilist_id=1, mal_id=11)
        sequel = make_anime("sequel", anilist_id=2, mal_id=22)
        jikan_only = make_anime("jikan-only", mal_id=33)

        linked = set_relations(
            source,
            [
                {"id": 2, "mal_id": 22, "type": "SEQUEL", "title": "Sequel"},
                {"id": None, "mal_id": 33, "type": "SIDE_STORY", "title": "Side"},
                {"id": 9, "mal_id": 99, "type": "PREQUEL", "title": "Not imported"},
                {"id": None, "mal_id": 22, "type": "OTHER", "title": "Repeat of the sequel"},
                "not a dict",
            ],
        )

        self.assertEqual(linked, 2)
        self.assertEqual(
            list(source.relations.values_list("relation_type", "to_anime_id", "position")),
            [("SEQUEL", sequel.id, 0), ("SIDE_STORY", jikan_only.id, 1), ("PREQUEL", None, 2)],
        )
        # Franchise queries now run in SQL.
        self.assertEqual(
            set(Anime.objects.filter(incoming_relations__from_anime=source)),
            {sequel, jikan_only},
        )

    def test_replaces_previous_relations(self):
        source = make_anime("source")
        set_relations(source, [{"id": 5, "type": "SEQUEL", "title": "Old"}])
        set_relations(source, [{"id": 6, "type": "PREQUEL", "title": "New"}])

        self.assertEqual(list(source.relations.values_list("title", flat=True)), ["New"])


class LinkRelationsTests(TestCase):
    def test_link_relations_to_fills_relations_imported_earlier(self):
        source = make_anime("source")
        set_relations(source, [{"id": None, "mal_id": 42, "type": "SEQUEL", "title": "Later"}])
        later = make_anime("later", mal_id=42)

        self.assertEqual(link_relations_to(later), 1)
        self.assertEqual(source.relations.get().to_anime, later)
        self.assertEqual(link_relations_to(make_anime("no-ids")), 0)

    def test_link_pending_relations_links_by_anilist_then_mal(self):
        source = make_anime("source")
        set_relations(
            source,
            [
                {"id": 7, "type": "SEQUEL", "title": "By AniList"},
                {"id": None, "mal_id": 8, "type": "PREQUEL", "title": "By MAL"},
                {"id": None, "mal_id": 9, "type": "OTHER", "title": "Missing"},
            ],
        )
        by_anilist = make_anime("by-anilist", anilist_id=7)
        by_mal = make_anime("by-mal", mal_id=8)

        self.assertEqual(link_pending_relations(), 2)
        self.assertEqual(
            list(source.relations.values_list("to_anime_id", flat=True)),
            [by_anilist.id, by_mal.id, None],
        )
        self.assertEqual(AnimeRelation.objects.filter(to_anime__isnull=True).count(), 1)

    def test_deleting_target_unlinks_relation(self):
        source = make_anime("source")
        target = make_anime("target", anilist_id=3)
        set_relations(source, [{"id": 3, "type": "SEQUEL", "title": "Target"}])

        target.delete()

        relation = source.relations.get()
        self.assertIsNone(relation.to_anime_id)
        self.assertEqual(relation.target_anilist_id, 3)


class SyncRelationsFromMediaTests(TestCase):
    def test_stores_anime_edges_and_links_incoming(self):
        prequel = make_anime("prequel")
        set_relations(prequel, [{"id": None, "mal_id": 50, "type": "SEQUEL", "title": "Me"}])
        anime = make_anime("me", mal_id=50)

        linked = sync_relations_from_media(
            anime,
            {
                "relations": {
                    "edges": [
                        edge("PREQUEL", mal_id=60, title="Prequel"),
                        edge("ADAPTATION", anilist_id=70, media_type="MANGA"),
                    ]
                }
            },
        )

        self.assertEqual(linked, 0)
        relation = anime.relations.get()
        self.assertEqual(
            (relation.relation_type, relation.target_mal_id, relation.title, relation.cover),
            ("PREQUEL", 60, "Prequel", "https://img.anilist.co/cover.jpg"),
        )
        self.assertEqual(prequel.relations.get().to_anime, anime)

    def test_payload_without_relations_keeps_stored_ones(self):
        anime = make_anime("me")
        set_relations(anime, [{"id": 1, "type": "SEQUEL", "title": "Kept"}])

        self.assertIsNone(sync_relations_from_media(anime, {"relations": None}))
        self.assertEqual(anime.relations.count(), 1)

    def test_jikan_list_payloads_carry_no_relations(self):
        service = JikanService(enable_caching=False, enable_rate_limiting=False)

        self.assertIsNone(service._normalize_anime_item({"mal_id": 5, "title": "List"})["relations"])
        full = service._normalize_anime_item(
            {
                "mal_id": 5,
                "title": "Full",
                "relations": [
                    {"relation": "Sequel", "entry": [{"mal_id": 6, "type": "anime", "name": "S2"}]}
                ],
            }
        )
        self.assertEqual(full["relations"]["edges"][0]["node"]["idMal"], 6)
