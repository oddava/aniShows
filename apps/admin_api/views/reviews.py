from django_filters import BooleanFilter, FilterSet, NumberFilter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.mixins import DestroyModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.animes.admin_serializers import AdminReviewSerializer
from apps.animes.models import Review
from apps.core.permissions import IsAdminUser
from apps.shared.pagination import StandardPagination


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
    pagination_class = StandardPagination
    serializer_class = AdminReviewSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ReviewFilter
    search_fields = ['content', 'user__username', 'anime__title']
    ordering_fields = ['created_at', 'rating', 'helpful_count']
    ordering = ['-created_at']

    def get_queryset(self):
        return Review.objects.select_related("user", "anime")

    def destroy(self, request, *args, **kwargs):
        """Delete a review for moderation purposes."""
        review = self.get_object()
        review_id = review.id
        self.perform_destroy(review)
        return Response({"message": f"Review {review_id} deleted successfully."})
