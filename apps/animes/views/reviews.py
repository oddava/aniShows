from http import HTTPStatus

from django.contrib.auth import get_user_model
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.animes.serializers import (
    ReviewCommentSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
)
from apps.animes.serializers.reviews import ReviewCommentsQuerySerializer
from apps.animes.services.reviews import (
    add_review_comment,
    create_review,
    delete_review,
    delete_review_comment,
    get_review_comments,
    get_review_queryset,
    get_review_stats,
    report_review,
    update_review,
    update_review_comment,
    vote_on_review,
)
from apps.users.permissions import EmailVerificationMixin

User = get_user_model()

class ReviewViewSet(EmailVerificationMixin, ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
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

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def vote(self, request, pk=None):
        review = self.get_object()
        result = vote_on_review(review, request.user, request.data.get("is_helpful", True))
        return Response(result.payload, status=result.status_code)

    @action(detail=True, methods=["get"])
    def comments(self, request, pk=None):
        review = self.get_object()
        query_serializer = ReviewCommentsQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        page = query_serializer.validated_data["page"]
        page_size = query_serializer.validated_data["page_size"]
        paginated_comments, total = get_review_comments(review, page, page_size)
        serializer = ReviewCommentSerializer(
            paginated_comments, many=True, context={"request": request}
        )

        return Response(
            {
                "results": serializer.data,
                "count": total,
                "next": page * page_size < total,
                "page": page,
            }
        )

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def add_comment(self, request, pk=None):
        review = self.get_object()
        result = add_review_comment(review, request.user, request.data.get("text", ""))
        if result.status_code != 201:
            return Response(result.payload, status=result.status_code)
        comment = result.payload["comment"]
        serializer = ReviewCommentSerializer(comment, context={"request": request})
        return Response(serializer.data, status=HTTPStatus.CREATED)

    @action(
        detail=True,
        methods=["patch"],
        permission_classes=[permissions.IsAuthenticated],
        url_path="comments/(?P<comment_id>[^/.]+)",
    )
    def update_comment(self, request, pk=None, comment_id=None):
        review = self.get_object()
        result = update_review_comment(review, comment_id, request.user, request.data.get("text", ""))
        if result.status_code != 200:
            return Response(result.payload, status=result.status_code)
        comment = result.payload["comment"]
        serializer = ReviewCommentSerializer(comment, context={"request": request})
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["delete"],
        permission_classes=[permissions.IsAuthenticated],
        url_path="comments/(?P<comment_id>[^/.]+)/delete",
    )
    def delete_comment(self, request, pk=None, comment_id=None):
        review = self.get_object()
        result = delete_review_comment(review, comment_id, request.user)
        return Response(result.payload, status=result.status_code)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def report(self, request, pk=None):
        review = self.get_object()
        serializer = ReviewReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = report_review(review, request.user, serializer.validated_data)
        return Response(result.payload, status=result.status_code)
