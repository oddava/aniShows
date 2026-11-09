"""Helpers for ``AnimeRelation`` franchise edges.

Providers name the related anime by real IDs: AniList (None for Jikan-sourced edges) and
MyAnimeList. A relation's ``to_anime`` is filled once a local anime with one of those IDs
exists; until then the provider's title/cover snapshot is all there is.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import Exists, OuterRef, Q, Subquery

from ..models import Anime, AnimeRelation

if TYPE_CHECKING:
    from collections.abc import Iterable

RelationKey = tuple[str, int]


def anime_relation_edges(media: dict[str, Any]) -> list[dict[str, Any]]:
    edges = (media.get("relations") or {}).get("edges") or []
    return [edge for edge in edges if (edge.get("node") or {}).get("type") == "ANIME"]


def relations_from_edges(edges: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build relation entries (the API payload shape, minus ``slug``) from provider edges."""
    relations = []
    for edge in edges:
        node = edge.get("node") or {}
        title_data = node.get("title") or {}
        relations.append(
            {
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
            }
        )
    return relations


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def set_relations(anime: Anime, entries: Iterable[dict[str, Any]]) -> int:
    """Replace ``anime``'s relations, linking targets that exist locally.

    Entries repeating an AniList or MAL ID seen earlier in the list are dropped. Returns
    how many relations are linked to a local anime.
    """
    relations = []
    seen: set[RelationKey] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        anilist_id = _positive_int(entry.get("id"))
        mal_id = _positive_int(entry.get("mal_id"))
        keys = {key for key in (("anilist", anilist_id), ("mal", mal_id)) if key[1]}
        if keys & seen:
            continue
        seen |= keys
        relations.append(
            AnimeRelation(
                from_anime=anime,
                relation_type=str(entry.get("type") or "")[:32],
                target_anilist_id=anilist_id,
                target_mal_id=mal_id,
                title=str(entry.get("title") or "")[:500],
                format=str(entry.get("format") or "")[:32],
                status=str(entry.get("status") or "")[:32],
                cover=str(entry.get("cover") or "")[:1000],
                position=len(relations),
            )
        )

    anilist_ids = {rel.target_anilist_id for rel in relations if rel.target_anilist_id}
    mal_ids = {rel.target_mal_id for rel in relations if rel.target_mal_id}
    by_anilist: dict[int, int] = {}
    by_mal: dict[int, int] = {}
    if anilist_ids or mal_ids:
        targets = Anime.objects.filter(Q(anilist_id__in=anilist_ids) | Q(mal_id__in=mal_ids))
        for target_id, target_anilist_id, target_mal_id in targets.values_list(
            "id", "anilist_id", "mal_id"
        ):
            if target_anilist_id:
                by_anilist[target_anilist_id] = target_id
            if target_mal_id:
                by_mal[target_mal_id] = target_id
    for rel in relations:
        rel.to_anime_id = by_anilist.get(rel.target_anilist_id) or by_mal.get(rel.target_mal_id)

    with transaction.atomic():
        anime.relations.all().delete()
        AnimeRelation.objects.bulk_create(relations)
    if hasattr(anime, "_prefetched_objects_cache"):
        anime._prefetched_objects_cache.pop("relations", None)
    return sum(1 for rel in relations if rel.to_anime_id)


def link_relations_to(anime: Anime) -> int:
    """Link unlinked relations whose target IDs match ``anime``. Returns how many."""
    query = Q()
    if anime.anilist_id:
        query |= Q(target_anilist_id=anime.anilist_id)
    if anime.mal_id:
        query |= Q(target_mal_id=anime.mal_id)
    if not query:
        return 0
    return AnimeRelation.objects.filter(query, to_anime__isnull=True).update(to_anime=anime)


def link_pending_relations() -> int:
    """Link every unlinked relation whose target now exists locally. Returns how many."""
    linked = 0
    for target_field, anime_field in (
        ("target_anilist_id", "anilist_id"),
        ("target_mal_id", "mal_id"),
    ):
        match = Anime.objects.filter(**{anime_field: OuterRef(target_field)}).values("id")[:1]
        linked += (
            AnimeRelation.objects.filter(to_anime__isnull=True)
            .filter(Exists(match))
            .update(to_anime=Subquery(match))
        )
    return linked


def sync_relations_from_media(anime: Anime, media: dict[str, Any]) -> int | None:
    """Store a provider payload's relations and link incoming ones to ``anime``.

    Payloads without relations (Jikan list/search endpoints) leave the stored relations
    alone. Returns how many outgoing relations are linked, or None when skipped.
    """
    link_relations_to(anime)
    if media.get("relations") is None:
        return None
    return set_relations(anime, relations_from_edges(anime_relation_edges(media)))
