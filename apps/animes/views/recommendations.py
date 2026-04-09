from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import IntegerField, Serializer
from rest_framework.viewsets import ViewSet

from ...shared.logger import logger
from ...users.serializers.users import UserRecommendationSerializer


def _is_recommendations_cache_fresh(cached_data, stale_after_hours: int = 24) -> bool:
    """Check whether cached serialized recommendations are still fresh."""
    if not isinstance(cached_data, list) or not cached_data:
        return False

    stale_before = timezone.now() - timedelta(hours=stale_after_hours)
    newest_created_at = None

    for item in cached_data:
        if not isinstance(item, dict):
            continue
        created_at = item.get("created_at")
        if not created_at:
            continue
        parsed = parse_datetime(created_at)
        if parsed is None:
            continue
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.utc)
        if newest_created_at is None or parsed > newest_created_at:
            newest_created_at = parsed

    if newest_created_at is None:
        return False
    return newest_created_at >= stale_before


class RecommendationsViewSet(ViewSet):
    """Personalized anime recommendations for authenticated users"""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        from ..services.recommendations import RecommendationService

        class RecommendationsQuerySerializer(Serializer):
            limit = IntegerField(required=False, default=12, min_value=1, max_value=100)

        query_serializer = RecommendationsQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        limit = query_serializer.validated_data["limit"]

        cache_key = f"user_recommendations:{request.user.id}"
        cached_data = cache.get(cache_key)

        if cached_data and _is_recommendations_cache_fresh(cached_data):
            return Response(cached_data[:limit])
        if cached_data:
            cache.delete(cache_key)

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
        from ..services.recommendations import RecommendationService

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
        from ..services.recommendations import RecommendationService

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
