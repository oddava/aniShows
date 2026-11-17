from http import HTTPStatus

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.viewsets import ModelViewSet

from ...core.api_errors import api_response, error_response
from ...shared.throttling import ResilientUserRateThrottle
from ...users.permissions import VerifiedEmailForWrites
from ..serializers.reviews import (
    ReviewInteractionStateSerializer,
    ReviewReactionActionSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
    ReviewVoteActionSerializer,
)
from ..services.reviews import (
    ReviewActionResult,
    create_review,
    delete_review,
    get_interaction_review_queryset,
    get_review_interaction_state,
    get_review_queryset,
    get_review_stats,
    report_review,
    toggle_review_reaction,
    update_review,
    vote_on_review,
)


class ReviewWriteThrottle(ResilientUserRateThrottle):
    scope = "review_write"


class ReviewReportThrottle(ResilientUserRateThrottle):
    scope = "review_report"


class ReviewInteractionThrottle(ResilientUserRateThrottle):
    scope = "review_interaction"


# Added on top of the default anon / user throttles (spec 5 P0-8).
ACTION_THROTTLES: dict[str, type[BaseThrottle]] = {
    "create": ReviewWriteThrottle,
    "update": ReviewWriteThrottle,
    "partial_update": ReviewWriteThrottle,
    "destroy": ReviewWriteThrottle,
    "report": ReviewReportThrottle,
    "votes": ReviewInteractionThrottle,
    "reactions": ReviewInteractionThrottle,
}
INTERACTION_ACTIONS = frozenset({"votes", "reactions", "report"})


class ReviewViewSet(ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticatedOrReadOnly, VerifiedEmailForWrites]

    def get_queryset(self):
        if self.action in INTERACTION_ACTIONS:
            return get_interaction_review_queryset()
        return get_review_queryset(self.request.user, self.request.query_params)

    def get_throttles(self):
        throttles = super().get_throttles()
        extra = ACTION_THROTTLES.get(self.action)
        if extra is not None:
            throttles.append(extra())
        return throttles

    @action(detail=False, methods=["get"])
    def stats(self, request):
        anime_slug = request.query_params.get("anime")
        if not anime_slug:
            return error_response(
                "anime parameter required",
                code="missing_anime",
                status_code=HTTPStatus.BAD_REQUEST,
            )
        return api_response(get_review_stats(anime_slug), status_code=HTTPStatus.OK)

    def perform_create(self, serializer):
        create_review(serializer, self.request.user)

    def perform_update(self, serializer):
        update_review(serializer, self.request.user)

    def perform_destroy(self, instance):
        delete_review(instance, self.request.user)

    def _interaction_response(
        self, review_id: int, result: ReviewActionResult, *, default_code: str
    ) -> Response:
        payload = result.payload
        if result.status_code < HTTPStatus.BAD_REQUEST:
            state = get_review_interaction_state(review_id, self.request.user)
            payload = {**payload, **ReviewInteractionStateSerializer(state).data}
        return api_response(payload, status_code=result.status_code, default_code=default_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        url_path="votes",
    )
    def votes(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewVoteActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = vote_on_review(review, request.user, serializer.validated_data["vote_type"])
        return self._interaction_response(review.pk, result, default_code="review_vote_failed")

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, VerifiedEmailForWrites],
        url_path="reactions",
    )
    def reactions(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewReactionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = toggle_review_reaction(
            review,
            request.user,
            serializer.validated_data["reaction_type"],
        )
        return self._interaction_response(review.pk, result, default_code="review_reaction_failed")

    @action(
        detail=True, methods=["post"], permission_classes=[IsAuthenticated, VerifiedEmailForWrites]
    )
    def report(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = report_review(review, request.user, serializer.validated_data)
        return api_response(
            result.payload,
            status_code=result.status_code,
            default_code="review_report_failed",
        )
