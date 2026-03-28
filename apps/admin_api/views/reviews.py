from django.db.models import Case, Count, F, IntegerField, Q, Value, When
from django.utils import timezone
from django_filters import BooleanFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.animes.admin_serializers import AdminReviewSerializer
from apps.animes.models import Review, ReviewReport
from apps.core.permissions import IsAdminUser


class ReviewFilter(FilterSet):
    has_spoilers = BooleanFilter(field_name='has_spoilers')
    rating = NumberFilter(field_name='rating')
    min_rating = NumberFilter(field_name='rating', lookup_expr='gte')
    max_rating = NumberFilter(field_name='rating', lookup_expr='lte')

    class Meta:
        model = Review
        fields = ['has_spoilers', 'rating']


class AdminReviewViewSet(ListModelMixin, RetrieveModelMixin, DestroyModelMixin, GenericViewSet):
    """Review moderation for admins."""

    permission_classes = [IsAdminUser]
    serializer_class = AdminReviewSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ReviewFilter
    search_fields = ['text', 'user__username', 'anime__title']
    ordering_fields = ['created_at', 'rating']
    ordering = ['-created_at']

    def get_queryset(self):
        queryset = Review.objects.select_related("user", "anime")
        return queryset

    def destroy(self, request, *args, **kwargs):
        """Delete a review for moderation purposes."""
        review = self.get_object()
        review_id = review.id
        self.perform_destroy(review)
        return Response({"message": f"Review {review_id} deleted successfully."})

    @action(detail=False, methods=["get"])
    def reports(self, request):
        try:
            min_score = int(request.query_params.get("min_score", 1))
        except ValueError:
            return Response({"detail": "min_score must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        unresolved_report_statuses = [ReviewReport.Status.OPEN, ReviewReport.Status.IN_REVIEW]
        queryset = (
            Review.objects.select_related("user", "anime")
            .annotate(
                helpful_votes=Count("votes", filter=Q(votes__is_helpful=True), distinct=True),
                unhelpful_votes=Count("votes", filter=Q(votes__is_helpful=False), distinct=True),
                open_user_reports=Count(
                    "reports",
                    filter=Q(reports__status__in=unresolved_report_statuses),
                    distinct=True,
                ),
                spoiler_user_reports=Count(
                    "reports",
                    filter=Q(
                        reports__status__in=unresolved_report_statuses,
                        reports__reason=ReviewReport.Reason.SPOILER,
                    ),
                    distinct=True,
                ),
                spam_user_reports=Count(
                    "reports",
                    filter=Q(
                        reports__status__in=unresolved_report_statuses,
                        reports__reason=ReviewReport.Reason.SPAM,
                    ),
                    distinct=True,
                ),
                harassment_user_reports=Count(
                    "reports",
                    filter=Q(
                        reports__status__in=unresolved_report_statuses,
                        reports__reason=ReviewReport.Reason.HARASSMENT,
                    ),
                    distinct=True,
                ),
            )
            .annotate(
                report_score=(
                    F("open_user_reports")
                    + Case(
                        When(has_spoilers=True, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    )
                    + Case(
                        When(rating__lte=3, then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    )
                    + Case(
                        When(Q(text__isnull=True) | Q(text=""), then=Value(1)),
                        default=Value(0),
                        output_field=IntegerField(),
                    )
                )
            )
            .filter(report_score__gte=min_score)
            .order_by("-report_score", "-created_at")
        )

        page = self.paginate_queryset(queryset)
        results = page if page is not None else queryset

        payload = []
        for review in results:
            reasons = []
            if review.open_user_reports:
                reasons.append(f"User reports ({review.open_user_reports})")
            if review.spoiler_user_reports:
                reasons.append(f"Spoiler reports ({review.spoiler_user_reports})")
            if review.harassment_user_reports:
                reasons.append(f"Harassment reports ({review.harassment_user_reports})")
            if review.spam_user_reports:
                reasons.append(f"Spam reports ({review.spam_user_reports})")
            if review.has_spoilers:
                reasons.append("Contains spoilers")
            if review.rating <= 3:
                reasons.append("Low rating")
            if not review.text:
                reasons.append("No review text")
            if not reasons:
                reasons.append("Automated quality signal")
            payload.append(
                {
                    "id": review.id,
                    "report_score": review.report_score,
                    "reasons": reasons,
                    "user": {"id": review.user_id, "username": review.user.username},
                    "anime": {
                        "id": review.anime_id,
                        "title": review.anime.title,
                        "slug": review.anime.slug,
                    },
                    "rating": review.rating,
                    "has_spoilers": review.has_spoilers,
                    "helpful_votes": review.helpful_votes,
                    "unhelpful_votes": review.unhelpful_votes,
                    "open_user_reports": review.open_user_reports,
                    "created_at": review.created_at.isoformat(),
                    "text": review.text,
                }
            )

        report_queryset = ReviewReport.objects.filter(status__in=unresolved_report_statuses)
        summary = {
            "total_reports": queryset.count(),
            "spoiler_reports": queryset.filter(
                Q(has_spoilers=True) | Q(spoiler_user_reports__gt=0)
            ).count(),
            "low_rating_reports": queryset.filter(rating__lte=3).count(),
            "textless_reports": queryset.filter(Q(text__isnull=True) | Q(text="")).count(),
            "user_reported": queryset.filter(open_user_reports__gt=0).count(),
            "open_user_reports": report_queryset.count(),
        }

        if page is not None:
            response = self.get_paginated_response(payload)
            response.data["summary"] = summary
            return response

        return Response({"results": payload, "count": len(payload), "summary": summary})

    @action(detail=True, methods=["post"], url_path="reports/resolve")
    def resolve_reports(self, request, pk=None):
        review = self.get_object()
        resolution_status = request.data.get("status", ReviewReport.Status.RESOLVED)
        notes = str(request.data.get("notes", "")).strip()

        if resolution_status not in [ReviewReport.Status.RESOLVED, ReviewReport.Status.DISMISSED]:
            return Response(
                {"detail": "status must be either 'resolved' or 'dismissed'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = ReviewReport.objects.filter(
            review=review,
            status__in=[ReviewReport.Status.OPEN, ReviewReport.Status.IN_REVIEW],
        )
        updated = queryset.update(
            status=resolution_status,
            resolved_by=request.user,
            resolved_at=timezone.now(),
            resolution_notes=notes,
        )
        if updated == 0:
            return Response({"detail": "No open reports found for this review."}, status=400)

        return Response(
            {
                "message": f"{updated} reports marked as {resolution_status}.",
                "review_id": review.id,
                "resolved_reports": updated,
            }
        )
