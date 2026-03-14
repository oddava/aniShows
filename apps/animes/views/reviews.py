from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.models import Avg, Count, Exists, OuterRef, Q
from rest_framework import permissions, serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.animes.models import Review, ReviewComment, ReviewReport, ReviewVote
from apps.animes.serializers import (
    ReviewCommentSerializer,
    ReviewReportCreateSerializer,
    ReviewSerializer,
)
from apps.users.models import UserAnimeList
from apps.users.permissions import EmailVerificationMixin
from apps.users.services.cache import invalidate_user_caches

User = get_user_model()

class ReviewViewSet(EmailVerificationMixin, ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to write reviews."

    def get_queryset(self):
        queryset = Review.objects.select_related("user", "user__userprofile", "anime")

        queryset = queryset.annotate(
            _helpful_count=Count("votes", filter=Q(votes__is_helpful=True), distinct=True),
            _comment_count=Count("comments", filter=Q(comments__is_deleted=False), distinct=True),
        )

        queryset = queryset.annotate(
            _is_completed=Exists(
                UserAnimeList.objects.filter(
                    user=OuterRef("user"),
                    anime=OuterRef("anime"),
                    status=UserAnimeList.UserAnimeStatus.completed,
                )
            )
        )

        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _user_vote=Exists(
                    ReviewVote.objects.filter(user=user, review=OuterRef("pk"), is_helpful=True)
                )
            )

        anime_slug = self.request.query_params.get("anime")
        if anime_slug:
            queryset = queryset.filter(anime__slug=anime_slug)

        target_username = self.request.query_params.get("user")
        if target_username:
            queryset = queryset.filter(user__username=target_username)

        if self.request.query_params.get("mine") == "true" and self.request.user.is_authenticated:
            queryset = queryset.filter(user=self.request.user)

        rating_filter = self.request.query_params.get("rating")
        if rating_filter:
            try:
                stars = int(rating_filter)
                # Convert 5-star to 10-point scale: 5 stars = 9-10, 4 stars = 7-8, etc.
                min_rating = (stars - 1) * 2 + 1
                max_rating = stars * 2
                queryset = queryset.filter(rating__gte=min_rating, rating__lte=max_rating)
            except ValueError:
                pass

        sort = self.request.query_params.get("sort", "helpful")
        if sort == "highest":
            queryset = queryset.order_by("-rating", "-created_at")
        elif sort == "lowest":
            queryset = queryset.order_by("rating", "-created_at")
        elif sort == "newest":
            queryset = queryset.order_by("-created_at")
        else:
            queryset = queryset.order_by("-_helpful_count", "-created_at")

        return queryset

    @action(detail=False, methods=["get"])
    def stats(self, request):
        anime_slug = request.query_params.get("anime")
        if not anime_slug:
            return Response(
                {"error": "anime parameter required"},
                status=400,
            )

        reviews = Review.objects.filter(anime__slug=anime_slug)

        stats = reviews.aggregate(
            total=Count("id"),
            avg_overall=Avg("rating"),
            avg_story=Avg("rating_story"),
            avg_animation=Avg("rating_animation"),
            avg_music=Avg("rating_music"),
            avg_characters=Avg("rating_characters"),
            stars_1=Count("id", filter=Q(rating__gte=1, rating__lte=2)),
            stars_2=Count("id", filter=Q(rating__gte=3, rating__lte=4)),
            stars_3=Count("id", filter=Q(rating__gte=5, rating__lte=6)),
            stars_4=Count("id", filter=Q(rating__gte=7, rating__lte=8)),
            stars_5=Count("id", filter=Q(rating__gte=9, rating__lte=10)),
        )

        total = stats["total"]

        if total == 0:
            return Response(
                {
                    "total_reviews": 0,
                    "distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                    "averages": {
                        "overall": 0,
                        "story": None,
                        "animation": None,
                        "music": None,
                        "characters": None,
                    },
                }
            )

        distribution = {
            1: stats["stars_1"],
            2: stats["stars_2"],
            3: stats["stars_3"],
            4: stats["stars_4"],
            5: stats["stars_5"],
        }

        averages = {
            "overall": stats["avg_overall"] / 2 if stats["avg_overall"] else 0,
            "story": stats["avg_story"] / 2 if stats["avg_story"] else None,
            "animation": stats["avg_animation"] / 2 if stats["avg_animation"] else None,
            "music": stats["avg_music"] / 2 if stats["avg_music"] else None,
            "characters": stats["avg_characters"] / 2 if stats["avg_characters"] else None,
        }

        return Response(
            {"total_reviews": total, "distribution": distribution, "averages": averages}
        )

    def perform_create(self, serializer):
        user = self.request.user
        anime = serializer.validated_data.get("anime")
        if not anime:
            raise serializers.ValidationError({"non_field_errors": ["Anime not found."]})

        if not UserAnimeList.objects.filter(user=user, anime=anime).exists():
            raise serializers.ValidationError(
                {
                    "non_field_errors": [
                        "You must add this anime to your list before writing a review."
                    ]
                }
            )

        try:
            serializer.save(user=user)
            invalidate_user_caches(user.id, user.username)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["You have already reviewed this anime."]}
            )

    def perform_update(self, serializer):
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only edit your own reviews.")
        serializer.save()
        invalidate_user_caches(self.request.user.id, self.request.user.username)

    def perform_destroy(self, instance):
        if instance.user != self.request.user:
            raise PermissionDenied("You can only delete your own reviews.")
        instance.delete()
        invalidate_user_caches(self.request.user.id, self.request.user.username)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def vote(self, request, pk=None):
        review = self.get_object()
        user = request.user

        if review.user == user:
            return Response(
                {"error": "Cannot vote on your own review"},
                status=400,
            )

        is_helpful = request.data.get("is_helpful", True)

        existing_vote = ReviewVote.objects.filter(user=user, review=review).first()

        if existing_vote:
            if existing_vote.is_helpful == is_helpful:
                existing_vote.delete()
                return Response({"voted": False, "is_helpful": None})
            else:
                existing_vote.is_helpful = is_helpful
                existing_vote.save()
                return Response({"voted": True, "is_helpful": is_helpful})
        else:
            ReviewVote.objects.create(user=user, review=review, is_helpful=is_helpful)
            return Response({"voted": True, "is_helpful": is_helpful})

    @action(detail=True, methods=["get"])
    def comments(self, request, pk=None):
        review = self.get_object()

        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 10))

        comments = (
            review.comments.filter(is_deleted=False)
            .select_related("user", "user__userprofile", "review__user")
            .order_by("-created_at")
        )

        start = (page - 1) * page_size
        end = start + page_size
        total = comments.count()

        paginated_comments = comments[start:end]

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
        user = request.user

        text = request.data.get("text", "").strip()
        if not text:
            return Response(
                {"text": ["Comment text is required."]},
                status=400,
            )

        comment = ReviewComment.objects.create(user=user, review=review, text=text)

        serializer = ReviewCommentSerializer(comment, context={"request": request})
        return Response(serializer.data, status=201)

    @action(
        detail=True,
        methods=["patch"],
        permission_classes=[permissions.IsAuthenticated],
        url_path="comments/(?P<comment_id>[^/.]+)",
    )
    def update_comment(self, request, pk=None, comment_id=None):
        review = self.get_object()

        try:
            comment = review.comments.get(id=comment_id)
        except ReviewComment.DoesNotExist:
            return Response(
                {"detail": "Comment not found."},
                status=404,
            )

        if comment.user != request.user:
            raise PermissionDenied("You can only edit your own comments.")

        text = request.data.get("text", "").strip()
        if not text:
            return Response(
                {"text": ["Comment text is required."]},
                status=400,
            )

        comment.text = text
        comment.save()

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

        try:
            comment = review.comments.get(id=comment_id)
        except ReviewComment.DoesNotExist:
            return Response(
                {"detail": "Comment not found."},
                status=404,
            )

        if comment.user != request.user and review.user != request.user:
            raise PermissionDenied("You don't have permission to delete this comment.")

        comment.soft_delete()

        return Response({"deleted": True})

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def report(self, request, pk=None):
        review = self.get_object()
        user = request.user

        if review.user_id == user.id:
            return Response({"error": "You cannot report your own review."}, status=400)

        serializer = ReviewReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        report, created = ReviewReport.objects.update_or_create(
            review=review,
            reporter=user,
            defaults={
                "reason": serializer.validated_data["reason"],
                "description": serializer.validated_data.get("description", "").strip(),
                "status": ReviewReport.Status.OPEN,
                "resolved_by": None,
                "resolved_at": None,
                "resolution_notes": "",
            },
        )

        return Response(
            {
                "id": report.id,
                "review_id": review.id,
                "status": report.status,
                "created": created,
            },
            status=201 if created else 200,
        )
