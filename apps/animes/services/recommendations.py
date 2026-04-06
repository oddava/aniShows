from apps.shared.logger import logger

"""
Recommendation Engine Service

Lightweight content-based recommendation system using SQL and Python math.
No heavy ML libraries - optimized for free tier hosting.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.animes.models import Anime, UserFavorite, UserRecommendation
from apps.animes.services.offline_catalog import PLACEHOLDER_SYNOPSIS
from apps.users.models import UserAnimeList

User = get_user_model()


class ContentBasedRecommender:
    """Content-based recommendation using robust profile matching and quality gates."""

    POSITIVE_STATUSES = {
        UserAnimeList.UserAnimeStatus.watching,
        UserAnimeList.UserAnimeStatus.completed,
    }

    MAX_ANCHORS = 8
    MAX_STRICT_CANDIDATES = 500
    MAX_SOFT_CANDIDATES = 300

    MIN_MEMBER_COUNT = 25_000
    SOFT_MIN_MEMBER_COUNT = 8_000

    MIN_STRICT_SCORE = 56.0
    MIN_STRICT_CONFIDENCE = 0.45
    MIN_SOFT_SCORE = 68.0
    MIN_SOFT_CONFIDENCE = 0.68

    def get_user_preferences(self, user) -> dict:
        """Extract weighted user preferences from anime list and favorites."""
        preferences = {
            "liked_genres": defaultdict(float),
            "liked_studios": defaultdict(float),
            "preferred_types": defaultdict(float),
            "anchor_weights": defaultdict(float),
            "anchor_anime": {},
            "anchor_features": [],
            "watched_anime_ids": set(),
            "dominant_type": None,
        }

        favorite_anime_ids = set(
            UserFavorite.objects.filter(user=user).values_list("anime_id", flat=True)
        )

        user_lists = (
            UserAnimeList.objects.filter(user=user)
            .select_related("anime", "anime__studio")
            .prefetch_related("anime__genres")
        )

        for entry in user_lists:
            anime = entry.anime
            preferences["watched_anime_ids"].add(anime.id)

            interaction_weight = self._interaction_weight(entry, anime.id in favorite_anime_ids)
            if interaction_weight <= 0:
                continue

            self._add_anime_preferences(preferences, anime, interaction_weight)

            if interaction_weight >= 0.95:
                preferences["anchor_weights"][anime.id] += interaction_weight
                preferences["anchor_anime"][anime.id] = anime

        favorites = (
            UserFavorite.objects.filter(user=user)
            .select_related("anime", "anime__studio")
            .prefetch_related("anime__genres")
        )
        for fav in favorites:
            anime = fav.anime
            preferences["watched_anime_ids"].add(anime.id)
            self._add_anime_preferences(preferences, anime, 1.1)
            preferences["anchor_weights"][anime.id] += 1.4
            preferences["anchor_anime"][anime.id] = anime

        self._normalize_counter(preferences["liked_genres"])
        self._normalize_counter(preferences["liked_studios"])
        self._normalize_counter(preferences["preferred_types"])

        if preferences["preferred_types"]:
            preferences["dominant_type"] = max(
                preferences["preferred_types"],
                key=preferences["preferred_types"].get,
            )

        anchor_ids = sorted(
            preferences["anchor_weights"],
            key=preferences["anchor_weights"].get,
            reverse=True,
        )[: self.MAX_ANCHORS]

        for anime_id in anchor_ids:
            anime = preferences["anchor_anime"].get(anime_id)
            if not anime:
                continue

            preferences["anchor_features"].append(
                {
                    "id": anime.id,
                    "title": anime.title,
                    "genre_ids": {g.id for g in anime.genres.all()},
                    "studio_id": anime.studio_id,
                    "anime_type": anime.anime_type,
                    "rating": float(anime.rating) if anime.rating is not None else None,
                }
            )

        return preferences

    def _interaction_weight(self, entry: UserAnimeList, is_favorite: bool) -> float:
        """Score interaction strength while filtering noisy list signals."""
        if entry.status in {
            UserAnimeList.UserAnimeStatus.dropped,
            UserAnimeList.UserAnimeStatus.on_hold,
        }:
            return 0.0

        weight = 0.0

        if entry.score >= 9:
            weight = 1.35
        elif entry.score == 8:
            weight = 1.15
        elif entry.score == 7 and entry.status in self.POSITIVE_STATUSES:
            weight = 0.95
        elif entry.score >= 7:
            weight = 0.75
        elif entry.status in self.POSITIVE_STATUSES and entry.score == 0:
            weight = 0.45

        if is_favorite:
            weight += 0.45

        return weight

    def _add_anime_preferences(self, preferences: dict, anime: Anime, weight: float) -> None:
        for genre in anime.genres.all():
            preferences["liked_genres"][genre.id] += weight

        if anime.studio_id:
            preferences["liked_studios"][anime.studio_id] += weight

        preferences["preferred_types"][anime.anime_type] += weight

    def _normalize_counter(self, values: defaultdict) -> None:
        if not values:
            return

        max_value = max(values.values())
        if max_value <= 0:
            return

        for key in values:
            values[key] /= max_value

    def calculate_genre_similarity(self, anime: Anime, preferences: dict) -> float:
        """Calculate weighted genre overlap between candidate and user preferences."""
        anime_genres = {g.id for g in anime.genres.all()}
        liked_genres = set(preferences["liked_genres"].keys())

        if not anime_genres or not liked_genres:
            return 0.0

        intersection = anime_genres & liked_genres
        if not intersection:
            return 0.0

        weighted_overlap = sum(preferences["liked_genres"][genre_id] for genre_id in intersection)
        return min(1.0, weighted_overlap / len(anime_genres))

    def _quality_prior(self, anime: Anime) -> float:
        """Estimate quality/popularity confidence in range [0, 1]."""
        popularity_score = 0.0
        if anime.popularity_rank:
            popularity_score = max(0.0, 1 - ((anime.popularity_rank - 1) / 5000))

        site_rank_score = 0.0
        if anime.site_rank:
            site_rank_score = max(0.0, 1 - ((anime.site_rank - 1) / 5000))

        trending_score = 0.0
        if anime.trending_rank:
            trending_score = max(0.0, 1 - ((anime.trending_rank - 1) / 3000))

        member_score = min((anime.member_count or 0) / 500_000, 1.0)
        rating_score = float(anime.rating) / 10.0 if anime.rating is not None else 0.0

        return max(popularity_score, site_rank_score, trending_score, member_score * 0.75, rating_score)

    def _best_anchor_match(self, anime: Anime, preferences: dict) -> tuple[float, dict | None]:
        """Find the strongest anchor similarity for the candidate anime."""
        anchors = preferences.get("anchor_features") or []
        if not anchors:
            return 0.0, None

        candidate_genres = {g.id for g in anime.genres.all()}
        anime_rating = float(anime.rating) if anime.rating is not None else None

        best_similarity = 0.0
        best_anchor = None

        for anchor in anchors:
            anchor_genres = anchor["genre_ids"]
            genre_similarity = 0.0
            if candidate_genres and anchor_genres:
                union = candidate_genres | anchor_genres
                if union:
                    genre_similarity = len(candidate_genres & anchor_genres) / len(union)

            studio_similarity = (
                1.0 if anime.studio_id and anchor["studio_id"] and anime.studio_id == anchor["studio_id"] else 0.0
            )
            type_similarity = 1.0 if anime.anime_type == anchor["anime_type"] else 0.0

            rating_similarity = 0.0
            if anime_rating is not None and anchor["rating"] is not None:
                rating_similarity = max(0.0, 1 - (abs(anime_rating - anchor["rating"]) / 10.0))

            similarity = (
                genre_similarity * 0.6
                + studio_similarity * 0.2
                + type_similarity * 0.1
                + rating_similarity * 0.1
            )

            if similarity > best_similarity:
                best_similarity = similarity
                best_anchor = anchor

        return best_similarity, best_anchor

    def calculate_content_score(self, anime: Anime, preferences: dict) -> tuple[float, dict]:
        """Calculate candidate score and explanation metadata."""
        metadata = {
            "matched_genres": [],
            "studio_match": False,
            "type_match": False,
            "confidence": 0.0,
            "anchor_similarity": 0.0,
        }

        genre_similarity = self.calculate_genre_similarity(anime, preferences)
        anchor_similarity, best_anchor = self._best_anchor_match(anime, preferences)
        quality_prior = self._quality_prior(anime)

        anime_genres = {g.id: g.name for g in anime.genres.all()}
        matched_genres = [
            anime_genres[genre_id]
            for genre_id in preferences["liked_genres"]
            if genre_id in anime_genres
        ]
        metadata["matched_genres"] = matched_genres[:5]

        score = genre_similarity * 0.35 + anchor_similarity * 0.4 + quality_prior * 0.15

        if anime.studio_id and anime.studio_id in preferences["liked_studios"]:
            metadata["studio_match"] = True
            metadata["studio"] = anime.studio.name if anime.studio else ""
            score += preferences["liked_studios"][anime.studio_id] * 0.07

        if anime.anime_type in preferences["preferred_types"]:
            metadata["type_match"] = True
            score += preferences["preferred_types"][anime.anime_type] * 0.05

        if anime.rating is not None:
            score += (float(anime.rating) / 10.0) * 0.03

        dominant_type = preferences.get("dominant_type")
        if dominant_type:
            if anime.anime_type == dominant_type:
                score *= 1.14
            elif anime.anime_type not in preferences["preferred_types"]:
                score *= 0.82

        confidence = min(1.0, genre_similarity * 0.35 + anchor_similarity * 0.45 + quality_prior * 0.2)
        metadata["confidence"] = round(confidence, 3)
        metadata["anchor_similarity"] = round(anchor_similarity, 3)

        if best_anchor and anchor_similarity >= 0.55:
            metadata["source_anime"] = best_anchor["title"]

        final_score = min(100.0, max(0.0, score * 100.0))
        return final_score, metadata

    def _base_candidate_queryset(self, preferences: dict):
        return (
            Anime.public_queryset()
            .exclude(id__in=preferences["watched_anime_ids"])
            .exclude(synopsis=PLACEHOLDER_SYNOPSIS)
            .exclude(status=Anime.AnimeStatus.unknown)
            .exclude(anime_type=Anime.AnimeType.unknown)
            .filter(rating__isnull=False)
            .select_related("studio")
            .prefetch_related("genres")
        )

    def _determine_reason(self, metadata: dict) -> str:
        if metadata.get("source_anime"):
            return UserRecommendation.RecommendationReason.BECAUSE_YOU_LIKED
        if metadata["matched_genres"]:
            return UserRecommendation.RecommendationReason.GENRE_MATCH
        if metadata["studio_match"]:
            return UserRecommendation.RecommendationReason.STUDIO_MATCH
        if metadata["type_match"]:
            return UserRecommendation.RecommendationReason.TYPE_MATCH
        return UserRecommendation.RecommendationReason.TOP_RATED

    def get_recommendations_for_user(self, user, limit: int = 50) -> list[dict]:
        """Generate content-based recommendations for a user."""
        preferences = self.get_user_preferences(user)

        has_preference_signal = bool(
            preferences["liked_genres"]
            or preferences["preferred_types"]
            or preferences["anchor_features"]
        )
        if not preferences["watched_anime_ids"] or not has_preference_signal:
            return self._get_fallback_recommendations(
                limit,
                dominant_type=preferences.get("dominant_type"),
            )

        base_queryset = self._base_candidate_queryset(preferences)

        strict_candidates = list(
            base_queryset.filter(member_count__gte=self.MIN_MEMBER_COUNT)
            .filter(
                Q(popularity_rank__isnull=False)
                | Q(site_rank__isnull=False)
                | Q(trending_rank__isnull=False)
            )
            .annotate(
                popularity_sort=Coalesce("popularity_rank", Value(1_000_000)),
                site_sort=Coalesce("site_rank", Value(1_000_000)),
                trending_sort=Coalesce("trending_rank", Value(1_000_000)),
            )
            .order_by("popularity_sort", "site_sort", "trending_sort", "-rating", "-member_count")[
                : self.MAX_STRICT_CANDIDATES
            ]
        )

        strict_ids = {anime.id for anime in strict_candidates}

        soft_candidates = list(
            base_queryset.exclude(id__in=strict_ids)
            .filter(member_count__gte=self.SOFT_MIN_MEMBER_COUNT)
            .annotate(
                popularity_sort=Coalesce("popularity_rank", Value(1_000_000)),
                site_sort=Coalesce("site_rank", Value(1_000_000)),
            )
            .order_by("-member_count", "-rating", "popularity_sort", "site_sort")[
                : self.MAX_SOFT_CANDIDATES
            ]
        )

        recommendations = []

        for anime in strict_candidates:
            score, metadata = self.calculate_content_score(anime, preferences)
            if score < self.MIN_STRICT_SCORE:
                continue
            if metadata["confidence"] < self.MIN_STRICT_CONFIDENCE:
                continue

            recommendations.append(
                {
                    "anime": anime,
                    "score": score,
                    "reason": self._determine_reason(metadata),
                    "metadata": metadata,
                }
            )

        for anime in soft_candidates:
            score, metadata = self.calculate_content_score(anime, preferences)
            if score < self.MIN_SOFT_SCORE:
                continue
            if metadata["confidence"] < self.MIN_SOFT_CONFIDENCE:
                continue
            if metadata["anchor_similarity"] < 0.65:
                continue

            recommendations.append(
                {
                    "anime": anime,
                    "score": score,
                    "reason": self._determine_reason(metadata),
                    "metadata": metadata,
                }
            )

        recommendations.sort(
            key=lambda row: (
                row["score"],
                row["metadata"].get("confidence", 0),
                row["anime"].member_count or 0,
            ),
            reverse=True,
        )

        diverse_recommendations = self._ensure_diversity(recommendations, limit)

        if len(diverse_recommendations) < limit:
            existing_ids = {row["anime"].id for row in diverse_recommendations}
            fallback_needed = limit - len(diverse_recommendations)
            fallback = self._get_fallback_recommendations(
                fallback_needed,
                exclude_ids=existing_ids | preferences["watched_anime_ids"],
                dominant_type=preferences.get("dominant_type"),
            )
            diverse_recommendations.extend(fallback)

        return diverse_recommendations[:limit]

    def _ensure_diversity(self, recommendations: list[dict], limit: int) -> list[dict]:
        """Apply light diversity guardrails without forcing low-confidence outliers."""
        genre_count = defaultdict(int)
        selected = []
        overflow = []
        seen_ids = set()

        max_per_genre = max(5, limit // 2)
        max_other = max(2, limit // 4)

        for rec in recommendations:
            anime_id = rec["anime"].id
            if anime_id in seen_ids:
                continue

            primary_genre = (
                rec["metadata"]["matched_genres"][0] if rec["metadata"]["matched_genres"] else "Other"
            )
            cap = max_other if primary_genre == "Other" else max_per_genre

            if genre_count[primary_genre] < cap:
                selected.append(rec)
                genre_count[primary_genre] += 1
                seen_ids.add(anime_id)
            else:
                overflow.append(rec)

            if len(selected) >= limit:
                break

        if len(selected) < limit:
            for rec in overflow:
                anime_id = rec["anime"].id
                if anime_id in seen_ids:
                    continue
                selected.append(rec)
                seen_ids.add(anime_id)
                if len(selected) >= limit:
                    break

        return selected

    def _get_fallback_recommendations(
        self,
        limit: int,
        exclude_ids: set[int] | None = None,
        dominant_type: str | None = None,
    ) -> list[dict]:
        """Fallback recommendations with strict quality gate and optional format bias."""
        if limit <= 0:
            return []

        exclude_ids = exclude_ids or set()
        recommendations = []
        seen_ids = set(exclude_ids)

        base_queryset = (
            Anime.public_queryset()
            .exclude(id__in=exclude_ids)
            .exclude(synopsis=PLACEHOLDER_SYNOPSIS)
            .exclude(status=Anime.AnimeStatus.unknown)
            .exclude(anime_type=Anime.AnimeType.unknown)
            .filter(rating__isnull=False, member_count__gte=self.SOFT_MIN_MEMBER_COUNT)
            .select_related("studio")
            .prefetch_related("genres")
        )

        def append_unique(queryset, score: float, reason: str) -> None:
            for anime in queryset:
                if anime.id in seen_ids:
                    continue

                adjusted_score = score
                if dominant_type:
                    if anime.anime_type == dominant_type:
                        adjusted_score += 4
                    elif anime.anime_type != Anime.AnimeType.tv:
                        adjusted_score -= 6

                recommendations.append(
                    {
                        "anime": anime,
                        "score": adjusted_score,
                        "reason": reason,
                        "metadata": {},
                    }
                )
                seen_ids.add(anime.id)

                if len(recommendations) >= limit:
                    return

        chunk = max(1, limit // 2)

        append_unique(
            base_queryset.filter(trending_rank__isnull=False).order_by("trending_rank", "site_rank")[:chunk],
            74.0,
            UserRecommendation.RecommendationReason.TRENDING,
        )

        if len(recommendations) < limit:
            append_unique(
                base_queryset.filter(site_rank__isnull=False).order_by("site_rank", "-rating")[:chunk],
                70.0,
                UserRecommendation.RecommendationReason.TOP_RATED,
            )

        if len(recommendations) < limit:
            append_unique(
                base_queryset.filter(popularity_rank__isnull=False).order_by("popularity_rank", "-rating")[:limit],
                67.0,
                UserRecommendation.RecommendationReason.TOP_RATED,
            )

        # Small environments and tests may not have enough high-signal rows.
        # Relax member_count/rank constraints as a last step to avoid empty recommendations.
        if len(recommendations) < limit:
            relaxed_queryset = (
                Anime.public_queryset()
                .exclude(id__in=seen_ids)
                .exclude(synopsis=PLACEHOLDER_SYNOPSIS)
                .exclude(status=Anime.AnimeStatus.unknown)
                .exclude(anime_type=Anime.AnimeType.unknown)
                .filter(rating__isnull=False)
                .order_by("-rating", "popularity_rank", "site_rank")
            )
            append_unique(
                relaxed_queryset[:limit],
                62.0,
                UserRecommendation.RecommendationReason.TOP_RATED,
            )

        return recommendations[:limit]


class RecommendationService:
    """Main service for generating and managing recommendations."""

    STALE_AFTER_HOURS = 24

    def __init__(self):
        self.content_recommender = ContentBasedRecommender()

    def generate_for_user(
        self, user, limit: int = 50, save: bool = True
    ) -> list[UserRecommendation] | list[dict]:
        """Generate and optionally save recommendations for a user."""
        try:
            recs = self.content_recommender.get_recommendations_for_user(user, limit=limit)

            if not save:
                return recs

            queryset = UserRecommendation.objects.filter(user=user)
            queryset.delete()

            recommendation_objects = [
                UserRecommendation(
                    user=user,
                    anime=rec_data["anime"],
                    score=Decimal(str(round(rec_data["score"], 2))),
                    reason=rec_data["reason"],
                    reason_metadata=rec_data["metadata"],
                )
                for rec_data in recs
            ]

            saved_recs = UserRecommendation.objects.bulk_create(
                recommendation_objects, ignore_conflicts=True
            )

            logger.info(f"Generated {len(saved_recs)} recommendations for user {user.username}")
            return saved_recs

        except Exception:
            logger.exception(f"Error generating recommendations for user {user.username}")
            return []

    def get_recommendations_for_user(self, user, limit: int = 12) -> list[UserRecommendation]:
        """Get cached recommendations for a user with stale-data refresh."""
        base_queryset = (
            UserRecommendation.objects.filter(user=user, is_dismissed=False)
            .exclude(anime__offline_sync_state__quarantined=True)
            .select_related("anime", "anime__studio")
            .prefetch_related("anime__genres")
        )

        stale_before = timezone.now() - timedelta(hours=self.STALE_AFTER_HOURS)
        has_any = base_queryset.exists()
        has_fresh = base_queryset.filter(created_at__gte=stale_before).exists() if has_any else False

        if not has_any or not has_fresh:
            self.generate_for_user(user)
            base_queryset = (
                UserRecommendation.objects.filter(user=user, is_dismissed=False)
                .exclude(anime__offline_sync_state__quarantined=True)
                .select_related("anime", "anime__studio")
                .prefetch_related("anime__genres")
            )

        return list(base_queryset.order_by("-score", "-created_at")[:limit])

    def generate_for_all_users(self) -> dict:
        """Generate recommendations for all active users."""
        stats = {
            "total_users": 0,
            "processed": 0,
            "failed": 0,
            "total_recommendations": 0,
            "failed_user_ids": [],
        }

        active_users = User.objects.filter(
            Q(anime_lists__isnull=False) | Q(favorites__isnull=False)
        ).distinct()

        stats["total_users"] = active_users.count()

        for user in active_users:
            try:
                recs = self.generate_for_user(user)
                stats["processed"] += 1
                stats["total_recommendations"] += len(recs)
            except Exception:
                stats["failed"] += 1
                stats["failed_user_ids"].append(user.id)
                logger.error(
                    "Failed to generate recommendations for user %s",
                    user.username,
                    exc_info=True,
                )

        logger.info(f"Recommendation generation complete: {stats}")
        return stats

    def dismiss_recommendation(self, user, anime_id: int) -> bool:
        """Allow user to dismiss a recommendation."""
        try:
            rec = UserRecommendation.objects.get(user=user, anime_id=anime_id)
            rec.is_dismissed = True
            rec.save()
            return True
        except UserRecommendation.DoesNotExist:
            return False
