"""Content-based personal recommendations.

How a run works
---------------
1. ``CandidatePool.build()`` loads the slice of the catalogue worth recommending once,
   as plain values rather than model instances: three tiers of ``AnimeFeatures``
   (id, type, rating, member count, the three ranks, genre and studio IDs), the local
   franchise edges between them, and the genre and studio names used in reasons.
2. ``ContentBasedRecommender.recommend()`` reads one user's list and favourites as
   ``values_list`` rows, turns them into a ``UserTaste`` and scores the pool in Python.
3. ``RecommendationService.generate_for_user()`` replaces the user's non-dismissed rows.
   Dismissed rows are kept, and their titles are never picked again.

The daily batch builds one pool per adult-content setting and shares it between users,
so each user costs a fixed handful of queries however long their list is.

Scores
------
A personal match scores 0-100 from taste overlap (``_score``) and must clear a quality
gate. "Next in" picks (the sequel of something the user completed) get a fixed boost.
Filler picks (trending or highly rated titles, used when there aren't enough matches)
score below ``FILLER_SCORE_CEILING``, so filler never outranks a real match.

Reads never generate: the API serves stored rows and queues a debounced task when they
are stale or missing (see ``views/recommendations.py``).
"""

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Any, TypedDict

from django.contrib.auth import get_user_model
from django.contrib.postgres.expressions import ArraySubquery
from django.core.cache import cache
from django.db import transaction
from django.db.models import Exists, OuterRef, Prefetch, Q, QuerySet, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from ...shared.logger import logger
from ...users.models import UserAnimeList, UserProfile
from ..models import (
    Anime,
    AnimeRelation,
    AnimeStudio,
    Genre,
    Studio,
    UserFavorite,
    UserRecommendation,
)
from .offline_catalog import PLACEHOLDER_SYNOPSIS
from .public_query.fields import QueryFieldsMixin

User = get_user_model()

# Rows older than this are served but refreshed in the background.
STALE_AFTER_HOURS = 24
# The daily batch only refreshes users active this recently ...
BATCH_ACTIVE_WITHIN = timedelta(days=30)
# ... whose recommendations are at least this old (list changes refresh sooner).
BATCH_REFRESH_AFTER = timedelta(days=7)
BATCH_CHUNK_SIZE = 200

# Generic fallback served while a user has no rows yet: the head of the trending shelf.
FALLBACK_CACHE_KEY = "user_recommendations_fallback:v1:adult:{adult}"
FALLBACK_CACHE_TTL = 60 * 10
FALLBACK_SIZE = 12

MAX_PER_FRANCHISE = 2
# Points added to a sequel of a title the user completed (scores are 0-100).
SEQUEL_BOOST = 15.0
# A completed prequel scored 1-5 is not a reason to recommend what follows it.
DISLIKED_MAX_SCORE = 5
# Filler picks score in [0, FILLER_SCORE_CEILING), below every personal gate.
FILLER_SCORE_CEILING = 50.0

# AniList stores relation types upper-case ("PREQUEL"); older rows may be "Prequel" or
# "Side story", so types are normalised before comparing.
PREQUEL = "prequel"
FRANCHISE_RELATION_TYPES = frozenset(
    {
        "prequel",
        "sequel",
        "parent",
        "side_story",
        "spin_off",
        "alternative",
        "summary",
        "compilation",
        "contains",
    }
)

_NO_RANK = 1_000_000


def recommendations_cache_key(user_id: int) -> str:
    """Return the per-user cache key the API stores the served payload under."""
    return f"user_recommendations:{user_id}"


def can_view_adult_content(user) -> bool:
    """Resolve the viewer's adult-content setting the same way the public API does."""
    from .public_anime_service import AnimeQueryService

    return AnimeQueryService.can_view_adult_content(user)


def _normalise_relation_type(value: str | None) -> str:
    return (value or "").strip().lower().replace(" ", "_")


def _rank(value: int | None) -> int:
    return value if value is not None else _NO_RANK


@dataclass(frozen=True, slots=True)
class AnimeFeatures:
    """The fields recommendation scoring reads, loaded with ``values()``."""

    id: int
    title: str
    anime_type: str
    rating: float | None
    member_count: int
    popularity_rank: int | None
    site_rank: int | None
    trending_rank: int | None
    genre_ids: frozenset[int]
    studio_ids: tuple[int, ...]  # provider order, primary studio first

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "AnimeFeatures":
        rating = row["rating"]
        return cls(
            id=row["id"],
            title=row["title"],
            anime_type=row["anime_type"],
            rating=float(rating) if rating is not None else None,
            member_count=row["member_count"] or 0,
            popularity_rank=row["popularity_rank"],
            site_rank=row["site_rank"],
            trending_rank=row["trending_rank"],
            genre_ids=frozenset(row["genre_id_list"] or ()),
            studio_ids=tuple(row["studio_id_list"] or ()),
        )


_FEATURE_FIELDS = (
    "id",
    "title",
    "anime_type",
    "rating",
    "member_count",
    "popularity_rank",
    "site_rank",
    "trending_rank",
)


def load_features(queryset: QuerySet, limit: int | None = None) -> list[AnimeFeatures]:
    """Load ``AnimeFeatures`` for ``queryset`` in one query (genre/studio IDs as arrays)."""
    genre_ids = (
        Anime.genres.through.objects.filter(anime_id=OuterRef("pk")).order_by().values("genre_id")
    )
    studio_ids = (
        AnimeStudio.objects.filter(anime_id=OuterRef("pk"))
        .order_by("position", "id")
        .values("studio_id")
    )
    rows = queryset.annotate(
        genre_id_list=ArraySubquery(genre_ids),
        studio_id_list=ArraySubquery(studio_ids),
    ).values(*_FEATURE_FIELDS, "genre_id_list", "studio_id_list")
    if limit is not None:
        rows = rows[:limit]
    return [AnimeFeatures.from_row(row) for row in rows]


def _candidate_queryset(*, include_adult: bool) -> QuerySet:
    queryset = (
        Anime.public_queryset()
        .exclude(synopsis=PLACEHOLDER_SYNOPSIS)
        .exclude(status=Anime.AnimeStatus.unknown)
        .exclude(anime_type=Anime.AnimeType.unknown)
        .filter(rating__isnull=False)
    )
    if not include_adult:
        queryset = queryset.filter(is_adult=False)
    return queryset


@dataclass
class CandidatePool:
    """Everything a run may recommend, loaded once and shared between users.

    ``strict`` and ``soft`` are the personal candidates (best first); ``relaxed`` only
    tops up filler in small catalogues.
    """

    MAX_STRICT = 500
    MAX_SOFT = 300
    MAX_RELAXED = 100
    MIN_MEMBER_COUNT = 25_000
    SOFT_MIN_MEMBER_COUNT = 8_000

    strict: list[AnimeFeatures]
    soft: list[AnimeFeatures]
    relaxed: list[AnimeFeatures]
    # candidate id -> IDs of the local anime its PREQUEL relations point to
    prequels: dict[int, tuple[int, ...]]
    # anime id -> franchise representative, for anime connected by franchise relations
    franchise_of: dict[int, int]
    genre_names: dict[int, str]
    studio_names: dict[int, str]
    by_id: dict[int, AnimeFeatures] = field(init=False)

    def __post_init__(self) -> None:
        self.by_id = {anime.id: anime for anime in (*self.strict, *self.soft, *self.relaxed)}

    @property
    def ranked(self) -> list[AnimeFeatures]:
        return [*self.strict, *self.soft]

    @property
    def prequel_ids(self) -> set[int]:
        return {anime_id for ids in self.prequels.values() for anime_id in ids}

    def franchise_key(self, anime_id: int) -> int:
        return self.franchise_of.get(anime_id, anime_id)

    @classmethod
    def build(cls, *, include_adult: bool) -> "CandidatePool":
        base = _candidate_queryset(include_adult=include_adult)
        strict = load_features(
            base.filter(member_count__gte=cls.MIN_MEMBER_COUNT)
            .filter(
                Q(popularity_rank__isnull=False)
                | Q(site_rank__isnull=False)
                | Q(trending_rank__isnull=False)
            )
            .order_by(
                Coalesce("popularity_rank", Value(_NO_RANK)),
                Coalesce("site_rank", Value(_NO_RANK)),
                Coalesce("trending_rank", Value(_NO_RANK)),
                "-rating",
                "-member_count",
            ),
            limit=cls.MAX_STRICT,
        )
        taken = [anime.id for anime in strict]
        soft = load_features(
            base.filter(member_count__gte=cls.SOFT_MIN_MEMBER_COUNT)
            .exclude(id__in=taken)
            .order_by(
                "-member_count",
                "-rating",
                Coalesce("popularity_rank", Value(_NO_RANK)),
                Coalesce("site_rank", Value(_NO_RANK)),
            ),
            limit=cls.MAX_SOFT,
        )
        taken += [anime.id for anime in soft]
        relaxed = load_features(
            base.exclude(id__in=taken).order_by("-rating", "popularity_rank", "site_rank"),
            limit=cls.MAX_RELAXED,
        )

        everything = [*strict, *soft, *relaxed]
        prequels, franchise_of = _franchise_edges([anime.id for anime in everything])
        studio_ids = {studio_id for anime in everything for studio_id in anime.studio_ids}
        return cls(
            strict=strict,
            soft=soft,
            relaxed=relaxed,
            prequels=prequels,
            franchise_of=franchise_of,
            genre_names=dict(Genre.objects.values_list("id", "name")),
            studio_names=dict(Studio.objects.filter(id__in=studio_ids).values_list("id", "name")),
        )


def _franchise_edges(
    anime_ids: list[int],
) -> tuple[dict[int, tuple[int, ...]], dict[int, int]]:
    """Read the local relations of ``anime_ids`` in one query.

    Returns each anime's local prequels and a franchise representative per anime
    (union-find over franchise relation types, so S1, S2 and the movie share one key).
    """
    parent: dict[int, int] = {}

    def find(node: int) -> int:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    prequels: defaultdict[int, list[int]] = defaultdict(list)
    edges = AnimeRelation.objects.filter(
        from_anime_id__in=anime_ids, to_anime_id__isnull=False
    ).values_list("from_anime_id", "to_anime_id", "relation_type")
    for source_id, target_id, relation_type in edges:
        if source_id == target_id:
            continue
        kind = _normalise_relation_type(relation_type)
        if kind == PREQUEL:
            prequels[source_id].append(target_id)
        if kind in FRANCHISE_RELATION_TYPES:
            parent[find(source_id)] = find(target_id)

    franchise_of = {node: find(node) for node in list(parent)}
    return {key: tuple(ids) for key, ids in prequels.items()}, franchise_of


@dataclass
class UserTaste:
    """What one user's list and favourites say about their taste."""

    seen_ids: set[int]  # everything on the list or favourited: never recommended
    completed_scores: dict[int, int]  # completed anime id -> list score (0 = unscored)
    titles: dict[int, str]
    liked_genres: dict[int, float]  # normalised to 0-1
    liked_studios: dict[int, float]
    preferred_types: dict[str, float]
    dominant_type: str | None
    anchors: list[AnimeFeatures]  # the user's strongest likes, best first

    @property
    def has_signal(self) -> bool:
        return bool(self.seen_ids) and bool(
            self.liked_genres or self.preferred_types or self.anchors
        )

    @classmethod
    def empty(cls) -> "UserTaste":
        return cls(set(), {}, {}, {}, {}, {}, None, [])


class RecommendationPick(TypedDict):
    anime: AnimeFeatures
    score: float
    reason: str
    metadata: dict[str, Any]


def _normalise(values: dict) -> dict:
    top = max(values.values(), default=0.0)
    if top <= 0:
        return dict(values)
    return {key: value / top for key, value in values.items()}


class ContentBasedRecommender:
    """Scores a ``CandidatePool`` against one user's taste."""

    POSITIVE_STATUSES = {
        UserAnimeList.UserAnimeStatus.watching,
        UserAnimeList.UserAnimeStatus.completed,
    }
    NEGATIVE_STATUSES = {
        UserAnimeList.UserAnimeStatus.dropped,
        UserAnimeList.UserAnimeStatus.on_hold,
    }

    MAX_ANCHORS = 8
    ANCHOR_MIN_WEIGHT = 0.95
    FAVORITE_WEIGHT = 1.1

    MIN_STRICT_SCORE = 56.0
    MIN_STRICT_CONFIDENCE = 0.45
    MIN_SOFT_SCORE = 68.0
    MIN_SOFT_CONFIDENCE = 0.68
    MIN_SOFT_ANCHOR_SIMILARITY = 0.65
    # Below this the closest anchor is not similar enough to name as the reason.
    MIN_SOURCE_ANCHOR_SIMILARITY = 0.55

    # --- taste -----------------------------------------------------------------------

    def _interaction_weight(self, status: str, score: int, is_favorite: bool) -> float:
        """How strongly one list entry says "more like this" (0 = no signal)."""
        if status in self.NEGATIVE_STATUSES:
            weight = 0.0
        elif score >= 9:
            weight = 1.35
        elif score == 8:
            weight = 1.15
        elif score == 7 and status in self.POSITIVE_STATUSES:
            weight = 0.95
        elif score >= 7:
            weight = 0.75
        elif status in self.POSITIVE_STATUSES and score == 0:
            weight = 0.45
        else:
            weight = 0.0

        if is_favorite:
            # A favourite is an explicit like, whatever the list entry says.
            weight = max(weight + 0.45, self.FAVORITE_WEIGHT)
        return weight

    def load_taste(self, user_id: int, pool: CandidatePool) -> UserTaste:
        """Build a ``UserTaste`` with three queries, independent of list length."""
        entries = list(
            UserAnimeList.objects.filter(user_id=user_id)
            .order_by()
            .values_list("anime_id", "status", "score")
        )
        favorite_ids = set(
            UserFavorite.objects.filter(user_id=user_id)
            .order_by()
            .values_list("anime_id", flat=True)
        )

        weights: dict[int, float] = {}
        completed_scores: dict[int, int] = {}
        for anime_id, status, score in entries:
            weights[anime_id] = self._interaction_weight(status, score, anime_id in favorite_ids)
            if status == UserAnimeList.UserAnimeStatus.completed:
                completed_scores[anime_id] = score
        for anime_id in favorite_ids - weights.keys():
            weights[anime_id] = self.FAVORITE_WEIGHT

        positive = {anime_id: weight for anime_id, weight in weights.items() if weight > 0}
        # Titles of completed prequels are needed for "Next in {title}".
        features = self._features_for(
            set(positive) | (pool.prequel_ids & completed_scores.keys()), pool
        )

        liked_genres: defaultdict[int, float] = defaultdict(float)
        liked_studios: defaultdict[int, float] = defaultdict(float)
        preferred_types: defaultdict[str, float] = defaultdict(float)
        for anime_id, weight in positive.items():
            anime = features.get(anime_id)
            if anime is None:
                continue
            for genre_id in anime.genre_ids:
                liked_genres[genre_id] += weight
            for studio_id in anime.studio_ids:
                liked_studios[studio_id] += weight
            preferred_types[anime.anime_type] += weight

        anchor_ids = sorted(
            (
                anime_id
                for anime_id, weight in positive.items()
                if weight >= self.ANCHOR_MIN_WEIGHT and anime_id in features
            ),
            key=lambda anime_id: positive[anime_id],
            reverse=True,
        )[: self.MAX_ANCHORS]

        types = _normalise(preferred_types)
        return UserTaste(
            seen_ids=set(weights),
            completed_scores=completed_scores,
            titles={anime_id: anime.title for anime_id, anime in features.items()},
            liked_genres=_normalise(liked_genres),
            liked_studios=_normalise(liked_studios),
            preferred_types=types,
            dominant_type=max(types, key=types.__getitem__) if types else None,
            anchors=[features[anime_id] for anime_id in anchor_ids],
        )

    @staticmethod
    def _features_for(anime_ids: set[int], pool: CandidatePool) -> dict[int, AnimeFeatures]:
        """Features from the pool, plus at most one query for anime outside it."""
        found = {anime_id: pool.by_id[anime_id] for anime_id in anime_ids if anime_id in pool.by_id}
        missing = anime_ids - found.keys()
        if missing:
            found.update(
                (anime.id, anime) for anime in load_features(Anime.objects.filter(id__in=missing))
            )
        return found

    # --- scoring ---------------------------------------------------------------------

    @staticmethod
    def _quality_prior(anime: AnimeFeatures) -> float:
        """Quality/popularity confidence in [0, 1]: the best of the catalogue signals."""
        signals = [min(anime.member_count / 500_000, 1.0) * 0.75]
        if anime.popularity_rank:
            signals.append(1 - (anime.popularity_rank - 1) / 5000)
        if anime.site_rank:
            signals.append(1 - (anime.site_rank - 1) / 5000)
        if anime.trending_rank:
            signals.append(1 - (anime.trending_rank - 1) / 3000)
        if anime.rating is not None:
            signals.append(anime.rating / 10.0)
        return max(0.0, *signals)

    @staticmethod
    def _genre_similarity(anime: AnimeFeatures, taste: UserTaste) -> float:
        """Weighted share of the candidate's genres that the user likes."""
        if not anime.genre_ids:
            return 0.0
        overlap = sum(taste.liked_genres.get(genre_id, 0.0) for genre_id in anime.genre_ids)
        return min(1.0, overlap / len(anime.genre_ids))

    @staticmethod
    def _anchor_similarity(anime: AnimeFeatures, anchor: AnimeFeatures) -> float:
        union = anime.genre_ids | anchor.genre_ids
        genre = len(anime.genre_ids & anchor.genre_ids) / len(union) if union else 0.0
        studio = 1.0 if set(anime.studio_ids) & set(anchor.studio_ids) else 0.0
        same_type = 1.0 if anime.anime_type == anchor.anime_type else 0.0
        rating = 0.0
        if anime.rating is not None and anchor.rating is not None:
            rating = max(0.0, 1 - abs(anime.rating - anchor.rating) / 10.0)
        return genre * 0.6 + studio * 0.2 + same_type * 0.1 + rating * 0.1

    def _best_anchor(
        self, anime: AnimeFeatures, taste: UserTaste
    ) -> tuple[float, AnimeFeatures | None]:
        best_similarity, best_anchor = 0.0, None
        for anchor in taste.anchors:
            similarity = self._anchor_similarity(anime, anchor)
            if similarity > best_similarity:
                best_similarity, best_anchor = similarity, anchor
        return best_similarity, best_anchor

    def _score(
        self, anime: AnimeFeatures, taste: UserTaste, pool: CandidatePool
    ) -> tuple[float, dict[str, Any]]:
        """Score a candidate 0-100 and explain it.

        The weights: genre overlap 35 %, closest anchor 40 %, catalogue quality 15 %,
        plus small bonuses for a liked studio, a preferred format and the rating; the
        user's dominant format is favoured and formats they never watch are damped.
        """
        genre_similarity = self._genre_similarity(anime, taste)
        anchor_similarity, best_anchor = self._best_anchor(anime, taste)
        quality = self._quality_prior(anime)

        score = genre_similarity * 0.35 + anchor_similarity * 0.4 + quality * 0.15

        matched = sorted(
            (genre_id for genre_id in anime.genre_ids if genre_id in taste.liked_genres),
            key=lambda genre_id: taste.liked_genres[genre_id],
            reverse=True,
        )
        metadata: dict[str, Any] = {
            "matched_genres": [
                pool.genre_names[genre_id] for genre_id in matched if genre_id in pool.genre_names
            ][:5],
            "studio_match": False,
            "type_match": False,
        }

        liked_studio = next(
            (studio_id for studio_id in anime.studio_ids if studio_id in taste.liked_studios),
            None,
        )
        if liked_studio is not None:
            metadata["studio_match"] = True
            metadata["studio"] = pool.studio_names.get(liked_studio, "this studio")
            score += taste.liked_studios[liked_studio] * 0.07

        if anime.anime_type in taste.preferred_types:
            metadata["type_match"] = True
            score += taste.preferred_types[anime.anime_type] * 0.05

        if anime.rating is not None:
            score += (anime.rating / 10.0) * 0.03

        if taste.dominant_type:
            if anime.anime_type == taste.dominant_type:
                score *= 1.14
            elif anime.anime_type not in taste.preferred_types:
                score *= 0.82

        confidence = min(1.0, genre_similarity * 0.35 + anchor_similarity * 0.45 + quality * 0.2)
        metadata["confidence"] = round(confidence, 3)
        metadata["anchor_similarity"] = round(anchor_similarity, 3)
        if best_anchor is not None and anchor_similarity >= self.MIN_SOURCE_ANCHOR_SIMILARITY:
            metadata["source_anime"] = best_anchor.title

        return min(100.0, max(0.0, score * 100.0)), metadata

    @staticmethod
    def _determine_reason(metadata: dict[str, Any]) -> str:
        reasons = UserRecommendation.RecommendationReason
        if metadata.get("source_anime"):
            return reasons.BECAUSE_YOU_LIKED
        if metadata["matched_genres"]:
            return reasons.GENRE_MATCH
        if metadata["studio_match"]:
            return reasons.STUDIO_MATCH
        if metadata["type_match"]:
            return reasons.TYPE_MATCH
        return reasons.TOP_RATED

    def _passes_gate(self, tier: str, score: float, metadata: dict[str, Any]) -> bool:
        if tier == "strict":
            return (
                score >= self.MIN_STRICT_SCORE
                and metadata["confidence"] >= self.MIN_STRICT_CONFIDENCE
            )
        return (
            score >= self.MIN_SOFT_SCORE
            and metadata["confidence"] >= self.MIN_SOFT_CONFIDENCE
            and metadata["anchor_similarity"] >= self.MIN_SOFT_ANCHOR_SIMILARITY
        )

    # --- franchises ------------------------------------------------------------------

    @staticmethod
    def _franchise_status(
        anime_id: int, taste: UserTaste, pool: CandidatePool
    ) -> tuple[bool, int | None]:
        """Return (eligible, completed prequel to name) for a candidate.

        A title whose local prequel the user hasn't completed is not eligible: season 3
        of a show they never started is not a recommendation. When every prequel is
        completed, the first one they didn't dislike is named ("Next in {title}").
        """
        prequel_ids = pool.prequels.get(anime_id, ())
        if any(prequel_id not in taste.completed_scores for prequel_id in prequel_ids):
            return False, None
        liked = [
            prequel_id
            for prequel_id in prequel_ids
            if not 1 <= taste.completed_scores[prequel_id] <= DISLIKED_MAX_SCORE
        ]
        return True, (liked[0] if liked else None)

    # --- selection -------------------------------------------------------------------

    def recommend(
        self,
        user_id: int,
        pool: CandidatePool,
        limit: int,
        *,
        excluded_ids: Iterable[int] = (),
    ) -> list[RecommendationPick]:
        """Pick up to ``limit`` titles for one user from ``pool``."""
        taste = self.load_taste(user_id, pool)
        blocked = taste.seen_ids | set(excluded_ids)
        franchise_counts: Counter[int] = Counter()

        picks = self._personal_picks(taste, pool, blocked) if taste.has_signal else []
        selected = self._diversify(picks, limit, pool, franchise_counts)
        selected += self._filler_picks(
            pool,
            taste,
            limit - len(selected),
            blocked | {pick["anime"].id for pick in selected},
            franchise_counts,
        )
        return selected[:limit]

    def _personal_picks(
        self, taste: UserTaste, pool: CandidatePool, blocked: set[int]
    ) -> list[RecommendationPick]:
        picks: list[RecommendationPick] = []
        for tier, candidates in (("strict", pool.strict), ("soft", pool.soft)):
            for anime in candidates:
                if anime.id in blocked:
                    continue
                eligible, sequel_of = self._franchise_status(anime.id, taste, pool)
                if not eligible:
                    continue

                score, metadata = self._score(anime, taste, pool)
                prequel_title = taste.titles.get(sequel_of) if sequel_of is not None else None
                if prequel_title:
                    score = min(100.0, score + SEQUEL_BOOST)
                    metadata["source_anime"] = prequel_title
                    metadata["sequel_of"] = prequel_title
                    reason = UserRecommendation.RecommendationReason.BECAUSE_YOU_LIKED
                elif self._passes_gate(tier, score, metadata):
                    reason = self._determine_reason(metadata)
                else:
                    continue
                picks.append(
                    {"anime": anime, "score": score, "reason": reason, "metadata": metadata}
                )

        picks.sort(
            key=lambda pick: (
                pick["score"],
                pick["metadata"]["confidence"],
                pick["anime"].member_count,
            ),
            reverse=True,
        )
        return picks

    @staticmethod
    def _diversify(
        picks: list[RecommendationPick],
        limit: int,
        pool: CandidatePool,
        franchise_counts: Counter[int],
    ) -> list[RecommendationPick]:
        """Take the best picks, at most two per franchise, without one genre taking over."""
        max_per_genre = max(5, limit // 2)
        max_without_genre = max(2, limit // 4)
        genre_counts: Counter[str | None] = Counter()
        selected: list[RecommendationPick] = []
        overflow: list[RecommendationPick] = []

        def take(pick: RecommendationPick) -> bool:
            franchise = pool.franchise_key(pick["anime"].id)
            if franchise_counts[franchise] >= MAX_PER_FRANCHISE:
                return False
            franchise_counts[franchise] += 1
            selected.append(pick)
            return True

        for pick in picks:
            if len(selected) >= limit:
                return selected
            genres = pick["metadata"]["matched_genres"]
            genre = genres[0] if genres else None
            cap = max_per_genre if genre else max_without_genre
            if genre_counts[genre] >= cap:
                overflow.append(pick)
            elif take(pick):
                genre_counts[genre] += 1

        for pick in overflow:
            if len(selected) >= limit:
                break
            take(pick)
        return selected

    def _filler_picks(
        self,
        pool: CandidatePool,
        taste: UserTaste,
        needed: int,
        blocked: set[int],
        franchise_counts: Counter[int],
    ) -> list[RecommendationPick]:
        """Top up with trending, then highly rated titles, scored below every real match."""
        if needed <= 0:
            return []
        reasons = UserRecommendation.RecommendationReason
        half = max(1, needed // 2)
        ranked = pool.ranked
        sources = (
            (
                reasons.TRENDING,
                half,
                sorted(
                    (anime for anime in ranked if anime.trending_rank is not None),
                    key=lambda anime: (anime.trending_rank, _rank(anime.site_rank)),
                ),
            ),
            (
                reasons.TOP_RATED,
                half,
                sorted(
                    (anime for anime in ranked if anime.site_rank is not None),
                    key=lambda anime: (anime.site_rank, -(anime.rating or 0)),
                ),
            ),
            (
                reasons.TOP_RATED,
                needed,
                sorted(
                    (anime for anime in ranked if anime.popularity_rank is not None),
                    key=lambda anime: (anime.popularity_rank, -(anime.rating or 0)),
                ),
            ),
            # Small catalogues (and tests) may lack ranked rows: relax the gates last.
            (reasons.TOP_RATED, needed, pool.relaxed),
        )

        picks: list[RecommendationPick] = []
        taken = set(blocked)
        for reason, cap, candidates in sources:
            added = 0
            for anime in candidates:
                if len(picks) >= needed or added >= cap:
                    break
                if anime.id in taken or not self._franchise_status(anime.id, taste, pool)[0]:
                    continue
                franchise = pool.franchise_key(anime.id)
                if franchise_counts[franchise] >= MAX_PER_FRANCHISE:
                    continue
                franchise_counts[franchise] += 1
                taken.add(anime.id)
                added += 1
                picks.append(
                    {
                        "anime": anime,
                        "score": self._filler_score(anime, taste),
                        "reason": reason,
                        "metadata": {},
                    }
                )
        return picks

    def _filler_score(self, anime: AnimeFeatures, taste: UserTaste) -> float:
        score = FILLER_SCORE_CEILING * min(self._quality_prior(anime), 0.999)
        if (
            taste.dominant_type
            and anime.anime_type != taste.dominant_type
            and anime.anime_type != Anime.AnimeType.tv
        ):
            score *= 0.85
        return score

    # --- convenience entry points ----------------------------------------------------

    def get_recommendations_for_user(self, user, limit: int = 50) -> list[RecommendationPick]:
        """Score recommendations for one user without saving them (builds its own pool)."""
        pool = CandidatePool.build(include_adult=can_view_adult_content(user))
        dismissed = UserRecommendation.objects.filter(
            user_id=user.id, is_dismissed=True
        ).values_list("anime_id", flat=True)
        return self.recommend(user.id, pool, limit, excluded_ids=set(dismissed))

    def _get_fallback_recommendations(
        self,
        limit: int,
        exclude_ids: set[int] | None = None,
        *,
        include_adult: bool = False,
    ) -> list[RecommendationPick]:
        """Filler picks for a user with no taste signal (no sequels, no adult titles)."""
        pool = CandidatePool.build(include_adult=include_adult)
        return self._filler_picks(pool, UserTaste.empty(), limit, set(exclude_ids or ()), Counter())


class RecommendationService:
    """Generates, stores, reads and dismisses personal recommendations."""

    STALE_AFTER_HOURS = STALE_AFTER_HOURS

    def __init__(self) -> None:
        self.content_recommender = ContentBasedRecommender()

    def generate_for_user(
        self,
        user,
        limit: int = 50,
        save: bool = True,
        *,
        pool: CandidatePool | None = None,
        can_view_adult: bool | None = None,
    ) -> list[UserRecommendation] | list[RecommendationPick]:
        """Generate (and by default store) recommendations for one user.

        Non-dismissed rows are replaced; dismissed rows stay and their titles are
        never picked again. Errors propagate so the caller decides: the per-user task
        retries, the batch logs and moves on.
        """
        if can_view_adult is None:
            can_view_adult = can_view_adult_content(user)
        if pool is None:
            pool = CandidatePool.build(include_adult=can_view_adult)

        dismissed_ids = set(
            UserRecommendation.objects.filter(user_id=user.id, is_dismissed=True)
            .order_by()
            .values_list("anime_id", flat=True)
        )
        picks = self.content_recommender.recommend(user.id, pool, limit, excluded_ids=dismissed_ids)
        if not save:
            return picks

        rows = [
            UserRecommendation(
                user_id=user.id,
                anime_id=pick["anime"].id,
                score=Decimal(str(round(pick["score"], 2))),
                reason=pick["reason"],
                reason_metadata=pick["metadata"],
            )
            for pick in picks
        ]
        with transaction.atomic():
            UserRecommendation.objects.filter(user_id=user.id, is_dismissed=False).delete()
            # ignore_conflicts keeps a dismissed row if one raced in meanwhile.
            saved = UserRecommendation.objects.bulk_create(rows, ignore_conflicts=True)
        cache.delete(recommendations_cache_key(user.id))

        logger.info("Generated %s recommendations for user %s", len(saved), user.id)
        return saved

    def get_recommendations_for_user(
        self, user, limit: int = 12, *, can_view_adult: bool | None = None
    ) -> list[UserRecommendation]:
        """Read the stored recommendations a viewer may see. Never generates."""
        if can_view_adult is None:
            can_view_adult = can_view_adult_content(user)

        queryset = UserRecommendation.objects.filter(user_id=user.id, is_dismissed=False).exclude(
            anime__offline_sync_state__quarantined=True
        )
        if not can_view_adult:
            # Covers rows generated before the user switched adult content off.
            queryset = queryset.filter(anime__is_adult=False)

        anime_fields = [f"anime__{name}" for name in QueryFieldsMixin.LIST_FIELDS]
        queryset = (
            queryset.select_related("anime")
            .only("id", "anime", "score", "reason", "reason_metadata", "created_at", *anime_fields)
            .prefetch_related(
                Prefetch(
                    "anime__genres",
                    queryset=Genre.objects.only(*QueryFieldsMixin.GENRE_FIELDS).order_by("name"),
                ),
                Anime.studios_prefetch("anime__"),
            )
            .order_by("-score", "-created_at")
        )
        return list(queryset[:limit])

    def trending_fallback(self, user, *, can_view_adult: bool, request=None) -> list[dict]:
        """Serve while a user has no rows yet: the head of the trending shelf.

        Items have the ``UserRecommendationSerializer`` shape with ``reason="trending"``;
        there is no row behind them, so ``id`` is the anime id (unique within the list),
        ``score`` and ``created_at`` are null. The shared part is cached for 10 min per
        adult setting; titles on the user's list or dismissed are dropped per request.
        """
        cache_key = FALLBACK_CACHE_KEY.format(adult=int(can_view_adult))
        items = cache.get(cache_key)
        if items is None:
            items = self._build_trending_fallback(can_view_adult=can_view_adult, request=request)
            cache.set(cache_key, items, FALLBACK_CACHE_TTL)
        if not items:
            return []

        anime_ids = [item["anime"]["id"] for item in items]
        hidden = set(
            UserAnimeList.objects.filter(user_id=user.id, anime_id__in=anime_ids)
            .order_by()
            .values_list("anime_id", flat=True)
            .union(
                UserRecommendation.objects.filter(
                    user_id=user.id, anime_id__in=anime_ids, is_dismissed=True
                )
                .order_by()
                .values_list("anime_id", flat=True)
            )
        )
        return [item for item in items if item["anime"]["id"] not in hidden]

    @staticmethod
    def _build_trending_fallback(*, can_view_adult: bool, request=None) -> list[dict]:
        from ..serializers.anime import AnimeListSerializer
        from .public_anime_service import AnimeQueryService

        queryset = (
            AnimeQueryService()
            .shelf_queryset_for(can_view_adult)
            .filter(trending_rank__isnull=False)
            .order_by("trending_rank")[:FALLBACK_SIZE]
        )
        reason = UserRecommendation.RecommendationReason.TRENDING
        reason_text = UserRecommendation(reason=reason).get_reason_display_text()
        animes = AnimeListSerializer(queryset, many=True, context={"request": request}).data
        return [
            {
                "id": anime["id"],
                "anime": dict(anime),
                "score": None,
                "reason": reason.value,
                "reason_text": reason_text,
                "reason_metadata": {},
                "created_at": None,
            }
            for anime in animes
        ]

    @staticmethod
    def batch_users() -> QuerySet:
        """Users the daily batch refreshes: active in the last 30 days, rows over 7 days old.

        "Active" is a list or favourite change, or a login. SimpleJWT doesn't update
        ``last_login`` (``UPDATE_LAST_LOGIN`` is off), so for most members the list
        activity is the signal; a member who only browses still gets a refresh on read
        once their rows are stale.
        """
        now = timezone.now()
        active_since = now - BATCH_ACTIVE_WITHIN
        lists = UserAnimeList.objects.filter(user_id=OuterRef("pk"))
        favorites = UserFavorite.objects.filter(user_id=OuterRef("pk"))
        recent_rows = UserRecommendation.objects.filter(
            user_id=OuterRef("pk"),
            is_dismissed=False,
            created_at__gte=now - BATCH_REFRESH_AFTER,
        )
        return (
            User.objects.filter(is_active=True)
            .filter(Q(Exists(lists)) | Q(Exists(favorites)))
            .filter(
                Q(last_login__gte=active_since)
                | Q(Exists(lists.filter(updated_at__gte=active_since)))
                | Q(Exists(favorites.filter(added_at__gte=active_since)))
            )
            .exclude(Exists(recent_rows))
            .annotate(
                show_adult=Exists(
                    UserProfile.objects.filter(user_id=OuterRef("pk"), show_adult_content=True)
                )
            )
            .only("id", "username")
            .order_by("id")
        )

    def generate_for_all_users(self, limit: int = 50) -> dict[str, Any]:
        """Refresh every user ``batch_users()`` selects; one failure never stops the batch."""
        stats: dict[str, Any] = {
            "total_users": 0,
            "processed": 0,
            "failed": 0,
            "total_recommendations": 0,
            "failed_user_ids": [],
        }
        pools: dict[bool, CandidatePool] = {}

        for user in self.batch_users().iterator(chunk_size=BATCH_CHUNK_SIZE):
            stats["total_users"] += 1
            show_adult = bool(user.show_adult)
            try:
                if show_adult not in pools:
                    pools[show_adult] = CandidatePool.build(include_adult=show_adult)
                saved = self.generate_for_user(
                    user, limit=limit, pool=pools[show_adult], can_view_adult=show_adult
                )
            except Exception:
                stats["failed"] += 1
                stats["failed_user_ids"].append(user.id)
                logger.exception("Failed to generate recommendations for user %s", user.id)
                continue
            stats["processed"] += 1
            stats["total_recommendations"] += len(saved)

        logger.info("Recommendation batch complete: %s", stats)
        return stats

    def dismiss_recommendation(self, user, anime_id: int) -> bool:
        """Mark a title as not interesting; it never comes back.

        Works for fallback items too (no row yet): a dismissed row is created so the
        next generation skips the title. Returns False when the anime doesn't exist.
        """
        if UserRecommendation.objects.filter(user_id=user.id, anime_id=anime_id).update(
            is_dismissed=True
        ):
            return True
        if not Anime.objects.filter(id=anime_id).exists():
            return False
        _, created = UserRecommendation.objects.get_or_create(
            user_id=user.id,
            anime_id=anime_id,
            defaults={
                "is_dismissed": True,
                "score": Decimal("0"),
                "reason": UserRecommendation.RecommendationReason.TRENDING,
            },
        )
        if not created:
            UserRecommendation.objects.filter(user_id=user.id, anime_id=anime_id).update(
                is_dismissed=True
            )
        return True
