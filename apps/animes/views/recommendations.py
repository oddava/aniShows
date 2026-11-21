"""Personal recommendations API (G2 Browse & discover).

GET serves stored rows and never generates in the request. Stale rows (older than
24 h) are served while a debounced refresh is queued. With no rows yet, it serves the
cached trending fallback and queues the first generation. The served payload is cached
per user, keyed by the adult-content setting it was built for: 1 h when fresh, 10 min
otherwise (stale, fallback or empty), and the task drops the key once it has written.
"""

import contextlib
from datetime import UTC, timedelta

from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import IntegerField, Serializer
from rest_framework.viewsets import ViewSet

from ...core.api_errors import error_response
from ...shared.errors import CACHE_ERRORS, ENQUEUE_ERRORS
from ...shared.logger import logger
from ...shared.public_cache import is_cache_outage_key
from ...shared.throttling import (
    ResilientScopedRateThrottle,
    ResilientUserRateThrottle,
    warn_cache_outage,
)
from ...users.serializers.recommendations import UserRecommendationSerializer
from ..services.recommendations import (
    STALE_AFTER_HOURS,
    RecommendationService,
    can_view_adult_content,
    recommendations_cache_key,
)
from ..services.user_list_side_effects import schedule_recommendations_debounced
from ..tasks.recommendations import generate_recommendations

FRESH_CACHE_TTL = 60 * 60
# Stale rows, the fallback and empty results: short, so a finished task shows soon.
SHORT_CACHE_TTL = 60 * 10
MAX_LIMIT = 100
# Countdown for a refresh queued by a read or by POST refresh/ (the debounce window
# is the countdown plus 30 s, see schedule_recommendations_debounced).
REFRESH_COUNTDOWN_SECONDS = 10


def _is_recommendations_cache_fresh(cached_data, stale_after_hours: int = 24) -> bool:
    """Check whether serialized recommendations are still fresh (newest ``created_at``)."""
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
            parsed = timezone.make_aware(parsed, UTC)
        if newest_created_at is None or parsed > newest_created_at:
            newest_created_at = parsed

    if newest_created_at is None:
        return False
    return newest_created_at >= stale_before


def _cache_get(key):
    """The cached value, or None when the cache (Redis) is down: then rebuild from the DB."""
    if is_cache_outage_key(key):
        return None
    try:
        return cache.get(key)
    except CACHE_ERRORS:
        warn_cache_outage("recommendations read")
        return None


def _cache_call(method: str, *args) -> None:
    """``cache.set``/``cache.delete``, best effort: a cache outage never fails the request."""
    if args and is_cache_outage_key(args[0]):
        return
    try:
        getattr(cache, method)(*args)
    except CACHE_ERRORS:
        warn_cache_outage(f"recommendations {method}")


# The debounce key G3's ``schedule_recommendations_debounced`` sets before it enqueues.
RECO_PENDING_KEY = "reco_pending:{user_id}"


def _queue_refresh(user_id: int) -> bool:
    """Queue a debounced generation for one user; False if the broker is unreachable."""
    try:
        schedule_recommendations_debounced(
            user_id, task=generate_recommendations, countdown=REFRESH_COUNTDOWN_SECONDS
        )
    except ENQUEUE_ERRORS:
        logger.warning("Could not queue recommendations for user %s", user_id, exc_info=True)
        # The helper marks the user pending before it enqueues; nothing was queued,
        # so a retry must not be debounced into a 202 for nothing.
        with contextlib.suppress(*CACHE_ERRORS):  # the cache itself may be what failed
            cache.delete(RECO_PENDING_KEY.format(user_id=user_id))
        return False
    return True


def _build_items(request, *, can_view_adult: bool) -> tuple[list[dict], bool]:
    """Return (serialized items, whether they are fresh personal rows)."""
    service = RecommendationService()
    recs = service.get_recommendations_for_user(
        request.user, limit=MAX_LIMIT, can_view_adult=can_view_adult
    )
    if recs:
        items = list(
            UserRecommendationSerializer(recs, many=True, context={"request": request}).data
        )
        return items, _is_recommendations_cache_fresh(items, STALE_AFTER_HOURS)
    fallback = service.trending_fallback(
        request.user, can_view_adult=can_view_adult, request=request
    )
    return fallback, False


def _drop_listed(user_id: int, items: list[dict]) -> list[dict]:
    """Never recommend what is already on the list (L2).

    Stored rows are built before later list writes and the payload is cached,
    so a show marked Watching or Completed since then is filtered at read time.
    """
    from ...users.models import UserAnimeList

    ids = [item["anime"]["id"] for item in items if isinstance(item.get("anime"), dict)]
    if not ids:
        return items
    listed = set(
        UserAnimeList.objects.filter(user_id=user_id, anime_id__in=ids).values_list(
            "anime_id", flat=True
        )
    )
    if not listed:
        return items
    return [item for item in items if item.get("anime", {}).get("id") not in listed]


class RecommendationsQuerySerializer(Serializer):
    limit = IntegerField(required=False, default=12, min_value=1, max_value=MAX_LIMIT)


class RecommendationsViewSet(ViewSet):
    """Personalized anime recommendations for authenticated users"""

    permission_classes = [IsAuthenticated]
    # Set per action (refresh/); declared here so @action may override it.
    throttle_scope: str | None = None

    def list(self, request):
        query_serializer = RecommendationsQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        limit = query_serializer.validated_data["limit"]

        user = request.user
        can_view_adult = can_view_adult_content(user)
        cache_key = recommendations_cache_key(user.id)
        cached = _cache_get(cache_key)
        if isinstance(cached, dict) and cached.get("adult") is can_view_adult:
            return Response(_drop_listed(user.id, cached["items"])[:limit])

        try:
            items, fresh = _build_items(request, can_view_adult=can_view_adult)
        except Exception:
            logger.exception("Error fetching recommendations")
            return error_response(
                "Failed to fetch recommendations",
                code="recommendations_fetch_failed",
                status_code=500,
            )

        if not fresh:
            _queue_refresh(user.id)
        _cache_call(
            "set",
            cache_key,
            {"adult": can_view_adult, "items": items},
            FRESH_CACHE_TTL if fresh else SHORT_CACHE_TTL,
        )
        return Response(_drop_listed(user.id, items)[:limit])

    @action(
        detail=False,
        methods=["post"],
        throttle_classes=[ResilientUserRateThrottle, ResilientScopedRateThrottle],
        throttle_scope="strict_user",
    )
    def refresh(self, request):
        """Queue a regeneration (debounced with list changes); 202 ``{"queued": true}``."""
        if not _queue_refresh(request.user.id):
            return error_response(
                "Could not queue a recommendations refresh",
                code="recommendations_refresh_unavailable",
                status_code=503,
            )
        return Response({"queued": True}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        try:
            anime_id = int(pk)
        except (ValueError, TypeError):
            return error_response(
                "Invalid anime ID",
                code="invalid_anime_id",
                status_code=400,
            )

        if not RecommendationService().dismiss_recommendation(request.user, anime_id):
            return error_response(
                "Recommendation not found",
                code="recommendation_not_found",
                status_code=404,
            )
        # The dismissal is saved; with the cache down the stale page lapses on its TTL.
        _cache_call("delete", recommendations_cache_key(request.user.id))
        return Response({"message": "Recommendation dismissed"})
