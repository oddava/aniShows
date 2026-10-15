"""Helpers for the denormalized ``Anime.relations`` JSON list.

Each relation entry names the related anime by real provider IDs: ``id`` is the AniList
ID (None for Jikan-sourced entries) and ``mal_id`` the MyAnimeList ID. ``slug`` is filled
in once the related anime exists locally.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.db.models import Q

from ..models import Anime

if TYPE_CHECKING:
    from collections.abc import Iterable

RelationKey = tuple[str, int]


def relation_key(relation: dict[str, Any]) -> RelationKey | None:
    anilist_id = relation.get("id")
    if anilist_id:
        return ("anilist", int(anilist_id))
    mal_id = relation.get("mal_id")
    if mal_id:
        return ("mal", int(mal_id))
    return None


def anime_keys(anime: Anime) -> list[RelationKey]:
    keys = []
    if anime.anilist_id:
        keys.append(("anilist", anime.anilist_id))
    if anime.mal_id:
        keys.append(("mal", anime.mal_id))
    return keys


def find_related_anime(
    relations: Iterable[dict[str, Any]], *, fields: tuple[str, ...] = ("id", "slug")
) -> dict[RelationKey, Anime]:
    """Map relation keys (AniList and MAL) to local anime rows in one query."""
    anilist_ids = set()
    mal_ids = set()
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        if relation.get("id"):
            anilist_ids.add(relation["id"])
        if relation.get("mal_id"):
            mal_ids.add(relation["mal_id"])
    if not anilist_ids and not mal_ids:
        return {}

    queryset = Anime.objects.filter(Q(anilist_id__in=anilist_ids) | Q(mal_id__in=mal_ids)).only(
        *{*fields, "anilist_id", "mal_id"}
    )
    found: dict[RelationKey, Anime] = {}
    for anime in queryset:
        for key in anime_keys(anime):
            found[key] = anime
    return found


def match_relation(relation: dict[str, Any], found: dict[RelationKey, Anime]) -> Anime | None:
    if relation.get("id") and ("anilist", relation["id"]) in found:
        return found[("anilist", relation["id"])]
    if relation.get("mal_id") and ("mal", relation["mal_id"]) in found:
        return found[("mal", relation["mal_id"])]
    return None


def anime_relation_edges(media: dict[str, Any]) -> list[dict[str, Any]]:
    edges = (media.get("relations") or {}).get("edges") or []
    return [edge for edge in edges if (edge.get("node") or {}).get("type") == "ANIME"]


def relations_from_edges(
    edges: Iterable[dict[str, Any]], current_relations: Iterable[dict[str, Any]] = ()
) -> list[dict[str, Any]]:
    """Build relation entries from provider edges, keeping slugs already linked."""
    current = {
        key: row
        for row in current_relations
        if isinstance(row, dict) and (key := relation_key(row)) is not None
    }
    relations = []
    for edge in edges:
        node = edge.get("node") or {}
        title_data = node.get("title") or {}
        entry = {
            "id": node.get("id"),
            "mal_id": node.get("idMal"),
            "type": edge.get("relationType"),
            "title": title_data.get("english")
            or title_data.get("romaji")
            or title_data.get("native")
            or "Unknown",
            "format": node.get("format"),
            "status": node.get("status"),
            "cover": (node.get("coverImage") or {}).get("large"),
            "slug": None,
        }
        key = relation_key(entry)
        if key in current:
            entry["slug"] = current[key].get("slug")
        relations.append(entry)
    return relations


def link_relation_slugs(relations: list[dict[str, Any]], *, keep_existing: bool = False) -> int:
    """Fill ``slug`` on each relation from local anime rows. Returns how many are linked."""
    found = find_related_anime(relations)
    linked = 0
    for relation in relations:
        match = match_relation(relation, found)
        if match is not None:
            relation["slug"] = match.slug
        elif not (keep_existing and relation.get("slug")):
            relation["slug"] = None
        if relation.get("slug"):
            linked += 1
    return linked
