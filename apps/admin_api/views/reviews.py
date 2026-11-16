from django.db import transaction
from django_filters import BooleanFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from ...animes.admin_serializers import AdminReviewSerializer
from ...animes.models import Review, ReviewReport
from ...core.models import AuditLog
from ..permissions import AdminPolicyMixin
from ..services.audit import record_admin_action
from ..services.moderation_service import (
    LEGACY_OUTCOME_RESOLVE,
    OUTCOME_DISMISS,
    ModerationError,
    parse_queue_filters,
    reported_reviews_queryset,
    resolve_review,
    serialize_reported_page,
)


class ReviewFilter(FilterSet):
    has_spoilers = BooleanFilter(field_name="has_spoilers")
    rating = NumberFilter(field_name="rating")
    min_rating = NumberFilter(field_name="rating", lookup_expr="gte")
    max_rating = NumberFilter(field_name="rating", lookup_expr="lte")

    class Meta:
        model = Review
        fields = ["has_spoilers", "rating"]


class AdminReviewViewSet(
    AdminPolicyMixin,
    ListModelMixin,
    RetrieveModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """Review moderation: staff list, read and delete reviews."""

    serializer_class = AdminReviewSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ReviewFilter
    search_fields = ["text", "user__username", "anime__title"]
    ordering_fields = ["created_at", "rating"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return Review.objects.select_related("user", "anime")

    def destroy(self, request, *args, **kwargs):
        """Delete a review (``Review.delete()``, so G5's signals run)."""
        review = self.get_object()
        review_id = review.id
        snapshot = {
            "author": review.user.username,
            "anime": review.anime.title,
            "rating": review.rating,
            "snippet": (review.text or "")[:200],
        }
        with transaction.atomic():
            review.delete()
            record_admin_action(
                request,
                action=AuditLog.ActionType.DELETE,
                entity_type="Review",
                entity_id=review_id,
                entity_repr=f"{snapshot['author']} on {snapshot['anime']}",
                previous=snapshot,
            )
        return Response({"message": f"Review {review_id} deleted successfully."})

    @action(detail=False, methods=["get"])
    def reports(self, request):
        """Deprecated: use ``moderation/reviews/``. Kept one release; same rows."""
        queue_filters = parse_queue_filters({"status": "open"})
        page = self.paginate_queryset(reported_reviews_queryset(queue_filters))
        response = self.get_paginated_response(serialize_reported_page(page or [], queue_filters))
        response["Deprecation"] = "true"
        return response

    @action(detail=True, methods=["post"], url_path="reports/resolve")
    def resolve_reports(self, request, pk=None):
        """Deprecated: use ``moderation/reviews/{id}/resolve/``."""
        resolution_status = request.data.get("status", ReviewReport.Status.RESOLVED)
        outcome = {
            ReviewReport.Status.RESOLVED: LEGACY_OUTCOME_RESOLVE,
            ReviewReport.Status.DISMISSED: OUTCOME_DISMISS,
        }.get(resolution_status)
        if outcome is None:
            return Response({"detail": "status must be either 'resolved' or 'dismissed'."}, 400)
        try:
            payload = resolve_review(request, pk, outcome, request.data.get("notes"), legacy=True)
        except ModerationError as exc:
            # The old endpoint answered 400 when nothing was open.
            code = 400 if exc.status_code == 409 else exc.status_code
            return Response({"detail": exc.message}, status=code)
        response = Response(
            {
                "message": f"{payload['reports_updated']} reports marked as {resolution_status}.",
                "review_id": payload["review_id"],
                "resolved_reports": payload["reports_updated"],
            }
        )
        response["Deprecation"] = "true"
        return response
