"""Taste compatibility between two people's lists (a Last.fm "Taste-o-meter").

Two numbers make the score:

* overlap: of the smaller list, how much the other person has also seen
  (Plan to Watch does not count as seen);
* agreement: on the shows both scored, how close the scores are
  (1 - mean |a - b| / 9).

With three or more shows scored by both, agreement weighs 60 % and overlap
40 %; with fewer, overlap alone decides, capped below "super" so two shared
shows never read as a perfect match.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from django.db.models import Prefetch

from ...animes.models import Anime, Genre
from ...shared.public_cache import best_effort_get, best_effort_set
from ..models import UserAnimeList

__all__ = ["CompatibilityResult", "compatibility_label", "compute_compatibility"]

PLAN = UserAnimeList.UserAnimeStatus.plan_to_watch
MIN_SCORED_FOR_AGREEMENT = 3
SHARED_SHOWN = 6
CACHE_SECONDS = 10 * 60


@dataclass(slots=True)
class CompatibilityResult:
    data: dict


def compatibility_label(score: int) -> str:
    if score >= 80:
        return "super"
    if score >= 60:
        return "high"
    if score >= 40:
        return "medium"
    if score >= 20:
        return "low"
    return "very_low"


def _seen(user_id: int) -> dict[int, int]:
    """anime_id -> score (0 = unscored) for everything the user has started."""
    rows = (
        UserAnimeList.objects.filter(user_id=user_id)
        .exclude(status=PLAN)
        .values_list("anime_id", "score")
    )
    return dict(rows)


def _score(viewer_seen: dict[int, int], target_seen: dict[int, int]) -> tuple[int, list[int]]:
    shared_ids = viewer_seen.keys() & target_seen.keys()
    smaller = min(len(viewer_seen), len(target_seen))
    if not shared_ids or not smaller:
        return 0, []

    overlap = len(shared_ids) / smaller
    both_scored = [
        (viewer_seen[a], target_seen[a]) for a in shared_ids if viewer_seen[a] and target_seen[a]
    ]
    if len(both_scored) >= MIN_SCORED_FOR_AGREEMENT:
        agreement = 1 - (sum(abs(a - b) for a, b in both_scored) / len(both_scored)) / 9
        raw = 0.6 * agreement + 0.4 * math.sqrt(overlap)
    else:
        raw = 0.75 * math.sqrt(overlap)
    score = max(0, min(100, round(raw * 100)))

    # Shows to name: the ones both liked most, then the most recent.
    ranked = sorted(
        shared_ids,
        key=lambda a: (-(viewer_seen[a] + target_seen[a]), -a),
    )
    return score, ranked[:SHARED_SHOWN]


def compute_compatibility(viewer, target, *, serialize_anime) -> CompatibilityResult:
    """``viewer`` and ``target`` are users; the caller checks visibility.

    ``serialize_anime`` turns a queryset of anime into a list of dicts.
    """
    key = f"compat:v1:{min(viewer.pk, target.pk)}:{max(viewer.pk, target.pk)}"
    cached = best_effort_get(key, source="compatibility")
    if cached:
        return CompatibilityResult(data=cached)

    viewer_seen = _seen(viewer.pk)
    target_seen = _seen(target.pk)
    score, shared_ids = _score(viewer_seen, target_seen)
    shared_count = len(viewer_seen.keys() & target_seen.keys())

    anime = []
    if shared_ids:
        by_id = {
            item.id: item
            for item in Anime.objects.filter(id__in=shared_ids).prefetch_related(
                Anime.studios_prefetch(),
                Prefetch("genres", queryset=Genre.objects.only("id", "name", "slug")),
            )
        }
        anime = serialize_anime([by_id[a] for a in shared_ids if a in by_id])

    data = {
        "score": score,
        "label": compatibility_label(score),
        "shared_count": shared_count,
        "shared": anime,
        # Too little to go on: the UI says so instead of showing a number.
        "enough_data": bool(viewer_seen) and bool(target_seen),
    }
    best_effort_set(key, data, CACHE_SECONDS, source="compatibility")
    return CompatibilityResult(data=data)
