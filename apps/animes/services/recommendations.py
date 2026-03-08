from apps.shared.logger import logger

"""
Recommendation Engine Service

Lightweight content-based recommendation system using SQL and Python math.
No heavy ML libraries - optimized for free tier hosting.
"""

from collections import defaultdict
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q

from apps.animes.models import Anime, UserFavorite, UserRecommendation
from apps.users.models import UserAnimeList

User = get_user_model()

class ContentBasedRecommender:
    """Content-based recommendation using genre, studio, and type similarity"""

    # Weights for different similarity components
    WEIGHTS = {
        "genres": 0.6,
        "studio": 0.2,
        "type": 0.1,
        "rating": 0.1,
    }

    def __init__(self):
        self.genre_cache = {}
        self.anime_features_cache = {}

    def get_user_preferences(self, user) -> dict:
        """Extract user preferences from their anime lists, favorites, and ratings"""
        preferences = {
            "liked_genres": defaultdict(int),
            "liked_studios": defaultdict(int),
            "preferred_types": defaultdict(int),
            "highly_rated_anime": [],
            "watched_anime_ids": set(),
        }

        # Pre-fetch all favorite anime IDs in a single query to avoid N+1
        favorite_anime_ids = set(
            UserFavorite.objects.filter(user=user).values_list("anime_id", flat=True)
        )

        # Get all user's anime lists with prefetched genres (avoids N+1 on anime.genres.all())
        user_lists = (
            UserAnimeList.objects.filter(user=user)
            .select_related("anime", "anime__studio")
            .prefetch_related("anime__genres")
        )

        for entry in user_lists:
            anime = entry.anime
            preferences["watched_anime_ids"].add(anime.id)

            # Weight by user score (0-10 scale)
            weight = entry.score / 10.0 if entry.score > 0 else 0.5

            # If user rated it highly or favorited it (uses pre-fetched set)
            if entry.score >= 7 or anime.id in favorite_anime_ids:
                preferences["highly_rated_anime"].append(anime)

                # Count genres (uses prefetched genres - no extra queries)
                for genre in anime.genres.all():
                    preferences["liked_genres"][genre.id] += weight

                # Count studios
                if anime.studio:
                    preferences["liked_studios"][anime.studio.id] += weight

                # Count types
                preferences["preferred_types"][anime.anime_type] += weight

        # Also consider favorites (even if not rated highly)
        favorites = (
            UserFavorite.objects.filter(user=user)
            .select_related("anime")
            .prefetch_related("anime__genres")
        )
        highly_rated_ids = {a.id for a in preferences["highly_rated_anime"]}
        for fav in favorites:
            anime = fav.anime
            preferences["watched_anime_ids"].add(anime.id)
            if anime.id not in highly_rated_ids:
                preferences["highly_rated_anime"].append(anime)
                highly_rated_ids.add(anime.id)
                for genre in anime.genres.all():
                    preferences["liked_genres"][genre.id] += 0.7

        # Normalize genre scores
        if preferences["liked_genres"]:
            max_genre_score = max(preferences["liked_genres"].values())
            for genre_id in preferences["liked_genres"]:
                preferences["liked_genres"][genre_id] /= max_genre_score

        return preferences

    def calculate_genre_similarity(self, anime: Anime, preferences: dict) -> float:
        """Calculate Jaccard similarity for genres.

        Uses prefetched genres from the queryset (no extra DB queries).
        """
        # Use prefetched genres - .all() on prefetched M2M is free (no query)
        anime_genres = {g.id for g in anime.genres.all()}
        liked_genres = set(preferences["liked_genres"].keys())

        if not anime_genres or not liked_genres:
            return 0.0

        # Weighted Jaccard
        intersection = anime_genres & liked_genres
        if not intersection:
            return 0.0

        # Weight by user's preference strength
        weighted_intersection = sum(preferences["liked_genres"][g] for g in intersection)
        union = anime_genres | liked_genres

        return weighted_intersection / len(union)

    def calculate_content_score(self, anime: Anime, preferences: dict) -> tuple[float, dict]:
        """Calculate content-based recommendation score.
        Returns (score, metadata) tuple.

        Uses prefetched genres/studio from the queryset (no extra DB queries).
        """
        score = 0.0
        metadata = {
            "matched_genres": [],
            "studio_match": False,
            "type_match": False,
        }

        # Genre similarity (0-1 scale)
        genre_sim = self.calculate_genre_similarity(anime, preferences)
        score += genre_sim * self.WEIGHTS["genres"]

        # Get matched genres (uses prefetched genres - no extra query)
        anime_genres = {g.id: g.name for g in anime.genres.all()}
        for genre_id in preferences["liked_genres"]:
            if genre_id in anime_genres:
                metadata["matched_genres"].append(anime_genres[genre_id])

        # Studio match
        if anime.studio and anime.studio.id in preferences["liked_studios"]:
            studio_weight = preferences["liked_studios"][anime.studio.id]
            score += studio_weight * self.WEIGHTS["studio"]
            metadata["studio_match"] = True
            metadata["studio"] = anime.studio.name

        # Type match
        if anime.anime_type in preferences["preferred_types"]:
            type_weight = preferences["preferred_types"][anime.anime_type]
            score += type_weight * self.WEIGHTS["type"]
            metadata["type_match"] = True

        # Rating boost (prefer highly-rated anime)
        if anime.rating:
            rating_score = (float(anime.rating) / 10.0) * self.WEIGHTS["rating"]
            score += rating_score

        # Normalize to 0-100 scale
        final_score = min(100.0, score * 100)

        return final_score, metadata

    def get_recommendations_for_user(self, user, limit: int = 50) -> list[dict]:
        """Generate content-based recommendations for a user.
        Returns list of dicts with anime, score, and reason.
        """
        preferences = self.get_user_preferences(user)

        # If user has no preferences, return trending/top-rated
        if not preferences["watched_anime_ids"]:
            return self._get_fallback_recommendations(limit)

        # Get candidates (exclude already watched/completed)
        candidates = (
            Anime.objects.exclude(id__in=preferences["watched_anime_ids"])
            .filter(rating__isnull=False)
            .prefetch_related("genres", "studio")
        )

        recommendations = []

        for anime in candidates[:200]:  # Limit processing to top 200 candidates
            score, metadata = self.calculate_content_score(anime, preferences)

            if score > 20:  # Minimum threshold
                # Determine primary reason
                if metadata["matched_genres"]:
                    reason = UserRecommendation.RecommendationReason.GENRE_MATCH
                elif metadata["studio_match"]:
                    reason = UserRecommendation.RecommendationReason.STUDIO_MATCH
                elif metadata["type_match"]:
                    reason = UserRecommendation.RecommendationReason.TYPE_MATCH
                else:
                    reason = UserRecommendation.RecommendationReason.TOP_RATED

                recommendations.append(
                    {
                        "anime": anime,
                        "score": score,
                        "reason": reason,
                        "metadata": metadata,
                    }
                )

        # Sort by score descending
        recommendations.sort(key=lambda x: x["score"], reverse=True)

        # Ensure diversity - max 30% from same genre
        diverse_recommendations = self._ensure_diversity(recommendations, limit)

        return diverse_recommendations

    def _ensure_diversity(self, recommendations: list[dict], limit: int) -> list[dict]:
        """Ensure genre diversity in recommendations"""
        genre_count = defaultdict(int)
        diverse = []
        max_per_genre = max(3, limit // 3)

        for rec in recommendations:
            primary_genre = (
                rec["metadata"]["matched_genres"][0]
                if rec["metadata"]["matched_genres"]
                else "Other"
            )

            if genre_count[primary_genre] < max_per_genre:
                diverse.append(rec)
                genre_count[primary_genre] += 1

            if len(diverse) >= limit:
                break

        return diverse

    def _get_fallback_recommendations(self, limit: int) -> list[dict]:
        """Get fallback recommendations for new users (trending + top rated)"""
        recommendations = []

        # Get trending
        trending = Anime.objects.filter(trending_rank__isnull=False).order_by("trending_rank")[
            : limit // 2
        ]

        for anime in trending:
            recommendations.append(
                {
                    "anime": anime,
                    "score": 70.0,
                    "reason": UserRecommendation.RecommendationReason.TRENDING,
                    "metadata": {},
                }
            )

        # Get top rated
        top_rated = Anime.objects.filter(rating__isnull=False, site_rank__isnull=False).order_by(
            "site_rank"
        )[: limit // 2]

        for anime in top_rated:
            if anime not in [r["anime"] for r in recommendations]:
                recommendations.append(
                    {
                        "anime": anime,
                        "score": 65.0,
                        "reason": UserRecommendation.RecommendationReason.TOP_RATED,
                        "metadata": {},
                    }
                )

        return recommendations[:limit]

class RecommendationService:
    """Main service for generating and managing recommendations"""

    def __init__(self):
        self.content_recommender = ContentBasedRecommender()

    def generate_for_user(self, user, save: bool = True) -> list[UserRecommendation]:
        """Generate and optionally save recommendations for a user"""
        try:
            recs = self.content_recommender.get_recommendations_for_user(user, limit=50)

            if not save:
                return recs

            # Clear old recommendations for this user
            UserRecommendation.objects.filter(user=user).delete()

            # Create new recommendations using bulk_create for performance
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
        """Get cached recommendations for a user"""
        # Check if we have recent recommendations
        recs = (
            UserRecommendation.objects.filter(user=user, is_dismissed=False)
            .select_related("anime")
            .prefetch_related("anime__genres")[:limit]
        )

        # If no recommendations or they're stale (>24h), generate new ones
        if not recs:
            self.generate_for_user(user)
            recs = (
                UserRecommendation.objects.filter(user=user, is_dismissed=False)
                .select_related("anime")
                .prefetch_related("anime__genres")[:limit]
            )

        return recs

    def generate_for_all_users(self) -> dict:
        """Generate recommendations for all active users"""
        stats = {
            "total_users": 0,
            "processed": 0,
            "failed": 0,
            "total_recommendations": 0,
        }

        # Get users with at least one anime in their list or favorites
        active_users = User.objects.filter(
            Q(anime_lists__isnull=False) | Q(favorites__isnull=False)
        ).distinct()

        stats["total_users"] = active_users.count()

        for user in active_users:
            try:
                recs = self.generate_for_user(user)
                stats["processed"] += 1
                stats["total_recommendations"] += len(recs)
            except Exception as e:
                stats["failed"] += 1
                logger.error(f"Failed to generate recommendations for user {user.username}: {e}")

        logger.info(f"Recommendation generation complete: {stats}")
        return stats

    def dismiss_recommendation(self, user, anime_id: int) -> bool:
        """Allow user to dismiss a recommendation"""
        try:
            rec = UserRecommendation.objects.get(user=user, anime_id=anime_id)
            rec.is_dismissed = True
            rec.save()
            return True
        except UserRecommendation.DoesNotExist:
            return False

    def record_impression(self, user, anime_id: int) -> None:
        """Record that a user saw this recommendation (for analytics)"""
        # This could update a counter or log to analytics
        pass
