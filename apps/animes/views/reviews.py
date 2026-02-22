from rest_framework import viewsets, serializers, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.db.models import Count, Q, Exists, OuterRef, Avg
from django.contrib.auth import get_user_model
from django.db import IntegrityError
import logging

from apps.animes.models import Anime, Review, ReviewVote, ReviewComment
from apps.users.models import UserAnimeList
from apps.animes.serializers import ReviewSerializer, ReviewCommentSerializer
from apps.users.permissions import EmailVerificationMixin
from apps.users.services.cache import invalidate_user_caches

logger = logging.getLogger(__name__)
User = get_user_model()


class ReviewViewSet(EmailVerificationMixin, viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    verification_error_message = "Please verify your email to write reviews."

    def get_queryset(self):
        queryset = Review.objects.select_related("user", "user__userprofile", "anime")

        # Always annotate helpful_count and comment_count to avoid N+1 queries
        queryset = queryset.annotate(
            _helpful_count=Count(
                "votes", filter=Q(votes__is_helpful=True), distinct=True
            ),
            _comment_count=Count(
                "comments", filter=Q(comments__is_deleted=False), distinct=True
            ),
        )

        # Annotate is_completed to avoid N+1 queries
        # Check if the reviewer has completed the anime
        queryset = queryset.annotate(
            _is_completed=Exists(
                UserAnimeList.objects.filter(
                    user=OuterRef("user"),
                    anime=OuterRef("anime"),
                    status=UserAnimeList.UserAnimeStatus.completed,
                )
            )
        )

        # Annotate user_vote for the current user to avoid N+1
        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                _user_vote=Exists(
                    ReviewVote.objects.filter(
                        user=user, review=OuterRef("pk"), is_helpful=True
                    )
                )
            )

        # Filter by anime
        anime_slug = self.request.query_params.get("anime")
        if anime_slug:
            queryset = queryset.filter(anime__slug=anime_slug)

        # Filter by target user
        target_username = self.request.query_params.get("user")
        if target_username:
            queryset = queryset.filter(user__username=target_username)

        # Filter by user (mine)
        if (
            self.request.query_params.get("mine") == "true"
            and self.request.user.is_authenticated
        ):
            queryset = queryset.filter(user=self.request.user)

        # Filter by rating (1-5 stars = 2-10 internal rating)
        rating_filter = self.request.query_params.get("rating")
        if rating_filter:
            try:
                stars = int(rating_filter)
                # Convert 5-star to 10-point scale: 5 stars = 9-10, 4 stars = 7-8, etc.
                min_rating = (stars - 1) * 2 + 1
                max_rating = stars * 2
                queryset = queryset.filter(
                    rating__gte=min_rating, rating__lte=max_rating
                )
            except ValueError:
                pass

        # Sorting
        sort = self.request.query_params.get("sort", "helpful")
        if sort == "highest":
            queryset = queryset.order_by("-rating", "-created_at")
        elif sort == "lowest":
            queryset = queryset.order_by("rating", "-created_at")
        elif sort == "newest":
            queryset = queryset.order_by("-created_at")
        else:  # helpful (default)
            queryset = queryset.order_by("-_helpful_count", "-created_at")

        return queryset

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get review statistics for an anime"""
        anime_slug = request.query_params.get("anime")
        if not anime_slug:
            return Response(
                {"error": "anime parameter required"},
                status=400,
            )

        reviews = Review.objects.filter(anime__slug=anime_slug)
        total = reviews.count()

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

        # Rating distribution (convert 10-point to 5-star)
        distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for review in reviews.values("rating"):
            rating = review["rating"] or 0
            stars = min(5, max(1, (rating + 1) // 2))
            distribution[stars] += 1

        # Average calculations
        averages = reviews.aggregate(
            overall=Avg("rating"),
            story=Avg("rating_story"),
            animation=Avg("rating_animation"),
            music=Avg("rating_music"),
            characters=Avg("rating_characters"),
        )

        # Convert to 5-point scale
        if averages["overall"]:
            averages["overall"] = averages["overall"] / 2
        if averages["story"]:
            averages["story"] = averages["story"] / 2
        if averages["animation"]:
            averages["animation"] = averages["animation"] / 2
        if averages["music"]:
            averages["music"] = averages["music"] / 2
        if averages["characters"]:
            averages["characters"] = averages["characters"] / 2

        return Response(
            {"total_reviews": total, "distribution": distribution, "averages": averages}
        )

    def perform_create(self, serializer):
        user = self.request.user
        anime = serializer.validated_data.get("anime")
        if not anime:
            raise serializers.ValidationError(
                {"non_field_errors": ["Anime not found."]}
            )

        # Check if user has anime on their list
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
            # Invalidate user caches - reviews count changed
            invalidate_user_caches(user.id, user.username)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["You have already reviewed this anime."]}
            )

    def perform_update(self, serializer):
        """Ensure users can only update their own reviews."""
        if serializer.instance.user != self.request.user:
            raise PermissionDenied("You can only edit your own reviews.")
        serializer.save()
        # Invalidate user caches - reviews may affect stats
        invalidate_user_caches(self.request.user.id, self.request.user.username)

    def perform_destroy(self, instance):
        """Ensure users can only delete their own reviews."""
        if instance.user != self.request.user:
            raise PermissionDenied("You can only delete your own reviews.")
        instance.delete()
        # Invalidate user caches - reviews count changed
        invalidate_user_caches(self.request.user.id, self.request.user.username)

    @action(
        detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated]
    )
    def vote(self, request, pk=None):
        """Toggle helpful vote on a review"""
        review = self.get_object()
        user = request.user

        # Can't vote on your own review
        if review.user == user:
            return Response(
                {"error": "Cannot vote on your own review"},
                status=400,
            )

        is_helpful = request.data.get("is_helpful", True)

        # Check if user already voted
        existing_vote = ReviewVote.objects.filter(user=user, review=review).first()

        if existing_vote:
            if existing_vote.is_helpful == is_helpful:
                # Same vote type - remove the vote
                existing_vote.delete()
                return Response({"voted": False, "is_helpful": None})
            else:
                # Different vote type - update the vote
                existing_vote.is_helpful = is_helpful
                existing_vote.save()
                return Response({"voted": True, "is_helpful": is_helpful})
        else:
            # Create new vote
            ReviewVote.objects.create(user=user, review=review, is_helpful=is_helpful)
            return Response({"voted": True, "is_helpful": is_helpful})

    @action(detail=True, methods=["get"])
    def comments(self, request, pk=None):
        """Get paginated comments for a review"""
        review = self.get_object()

        # Get pagination parameters
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 10))

        # Filter out soft-deleted comments
        comments = (
            review.comments.filter(is_deleted=False)
            .select_related("user", "user__userprofile")
            .order_by("-created_at")
        )

        # Manual pagination
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

    @action(
        detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated]
    )
    def add_comment(self, request, pk=None):
        """Add a comment to a review"""
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
        """Update a comment"""
        review = self.get_object()

        try:
            comment = review.comments.get(id=comment_id)
        except ReviewComment.DoesNotExist:
            return Response(
                {"detail": "Comment not found."},
                status=404,
            )

        # Only comment author can edit
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
        """Soft delete a comment"""
        review = self.get_object()

        try:
            comment = review.comments.get(id=comment_id)
        except ReviewComment.DoesNotExist:
            return Response(
                {"detail": "Comment not found."},
                status=404,
            )

        # Comment author or review owner can delete
        if comment.user != request.user and review.user != request.user:
            raise PermissionDenied("You don't have permission to delete this comment.")

        # Soft delete
        comment.soft_delete()

        return Response({"deleted": True})
