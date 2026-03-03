from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.core.cache import cache
import logging

from apps.animes.serializers import UserRecommendationSerializer

logger = logging.getLogger(__name__)


class RecommendationsViewSet(viewsets.ViewSet):
    """Personalized anime recommendations for authenticated users"""

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """Get personalized recommendations for the current user"""
        from apps.animes.services.recommendations import RecommendationService

        # Get limit parameter
        limit = int(request.query_params.get("limit", 12))

        # Always cache a generous set and slice to requested limit in Python,
        # so different ?limit= values share one cache entry per user.
        cache_key = f"user_recommendations:{request.user.id}"
        cached_data = cache.get(cache_key)

        if cached_data:
            return Response(cached_data[:limit])

        try:
            # Fetch a large batch to cache (covers most limit values)
            max_cache_limit = max(limit, 30)
            service = RecommendationService()
            recs = service.get_recommendations_for_user(request.user, limit=max_cache_limit)

            serializer = UserRecommendationSerializer(recs, many=True, context={"request": request})

            data = serializer.data

            # Cache for 1 hour
            cache.set(cache_key, data, 60 * 60)

            return Response(data[:limit])

        except Exception as e:
            logger.exception("Error fetching recommendations")
            return Response(
                {"error": "Failed to fetch recommendations"},
                status=500,
            )

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Force refresh recommendations for the current user"""
        from apps.animes.services.recommendations import RecommendationService

        try:
            # Clear cache
            cache_key = f"user_recommendations:{request.user.id}"
            cache.delete(cache_key)

            # Generate new recommendations
            service = RecommendationService()
            recs = service.generate_for_user(request.user)

            return Response(
                {
                    "message": f"Generated {len(recs)} new recommendations",
                    "count": len(recs),
                }
            )

        except Exception as e:
            logger.exception("Error refreshing recommendations")
            return Response(
                {"error": "Failed to refresh recommendations"},
                status=500,
            )

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        """Dismiss a recommendation (hide it from future results)"""
        from apps.animes.services.recommendations import RecommendationService

        try:
            anime_id = int(pk)
            service = RecommendationService()
            success = service.dismiss_recommendation(request.user, anime_id)

            if success:
                # Clear cache so dismissed item doesn't appear
                cache_key = f"user_recommendations:{request.user.id}"
                cache.delete(cache_key)

                return Response({"message": "Recommendation dismissed"})
            else:
                return Response(
                    {"error": "Recommendation not found"},
                    status=404,
                )

        except (ValueError, TypeError):
            return Response({"error": "Invalid anime ID"}, status=400)
