from django.core.cache import cache
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.serializers import IntegerField, Serializer
from rest_framework.viewsets import ViewSet

from apps.shared.logger import logger
from apps.users.serializers.users import UserRecommendationSerializer


class RecommendationsViewSet(ViewSet):
    """Personalized anime recommendations for authenticated users"""

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        from apps.animes.services.recommendations import RecommendationService

        class RecommendationsQuerySerializer(Serializer):
            limit = IntegerField(required=False, default=12, min_value=1, max_value=100)

        query_serializer = RecommendationsQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        limit = query_serializer.validated_data["limit"]

        cache_key = f"user_recommendations:{request.user.id}"
        cached_data = cache.get(cache_key)

        if cached_data:
            return Response(cached_data[:limit])

        try:
            max_cache_limit = max(limit, 30)
            service = RecommendationService()
            recs = service.get_recommendations_for_user(request.user, limit=max_cache_limit)

            serializer = UserRecommendationSerializer(recs, many=True, context={"request": request})

            data = serializer.data

            cache.set(cache_key, data, 60 * 60)

            return Response(data[:limit])

        except Exception:
            logger.exception("Error fetching recommendations")
            return Response(
                {"error": "Failed to fetch recommendations"},
                status=500,
            )

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        from apps.animes.services.recommendations import RecommendationService

        try:
            cache_key = f"user_recommendations:{request.user.id}"
            cache.delete(cache_key)

            service = RecommendationService()
            recs = service.generate_for_user(request.user)

            return Response(
                {
                    "message": f"Generated {len(recs)} new recommendations",
                    "count": len(recs),
                }
            )

        except Exception:
            logger.exception("Error refreshing recommendations")
            return Response(
                {"error": "Failed to refresh recommendations"},
                status=500,
            )

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        from apps.animes.services.recommendations import RecommendationService

        try:
            anime_id = int(pk)
            service = RecommendationService()
            success = service.dismiss_recommendation(request.user, anime_id)

            if success:
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
