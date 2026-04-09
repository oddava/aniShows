from http import HTTPStatus

from django.contrib.auth import get_user_model
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.animes.serializers import (
    ReviewReactionActionSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
    ReviewVoteActionSerializer,
)
from apps.animes.services.reviews import (
    create_review,
    delete_review,
    get_review_queryset,
    get_review_stats,
    report_review,
    toggle_review_reaction,
    update_review,
    vote_on_review,
)
from apps.users.permissions import EmailVerificationMixin

User = get_user_model()

class ReviewViewSet(EmailVerificationMixin, ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to write reviews."

    def get_queryset(self):
        return get_review_queryset(self.request.user, self.request.query_params)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        anime_slug = request.query_params.get("anime")
        if not anime_slug:
            return Response(
                {"error": "anime parameter required"},
                status=HTTPStatus.BAD_REQUEST,
            )
        return Response(get_review_stats(anime_slug))

    def perform_create(self, serializer):
        create_review(serializer, self.request.user)

    def perform_update(self, serializer):
        update_review(serializer, self.request.user)

    def perform_destroy(self, instance):
        delete_review(instance, self.request.user)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        url_path="votes",
    )
    def votes(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewVoteActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = vote_on_review(review, request.user, serializer.validated_data["vote_type"])
        return Response(result.payload, status=result.status_code)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
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
        return Response(result.payload, status=result.status_code)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def report(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = report_review(review, request.user, serializer.validated_data)
        return Response(result.payload, status=result.status_code)
