from dataclasses import dataclass

from django.db import IntegrityError
from django.db.models import Avg, Count, Exists, OuterRef, Q
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.animes.models import Review, ReviewComment, ReviewReport, ReviewVote
from apps.core.services.admin_settings_service import (
    are_review_comments_enabled,
    are_reviews_enabled,
)
from apps.users.models import UserAnimeList
from apps.users.services.cache import invalidate_user_caches


@dataclass(slots=True)
class ReviewActionResult:
    payload: dict
    status_code: int


def ensure_reviews_enabled():
    if not are_reviews_enabled():
        raise PermissionDenied("Reviews are currently disabled by the administrator.")


def ensure_comments_enabled():
    ensure_reviews_enabled()
    if not are_review_comments_enabled():
        raise PermissionDenied("Review comments are currently disabled by the administrator.")


def get_review_queryset(request_user, query_params):
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

    if request_user.is_authenticated:
        queryset = queryset.annotate(
            _user_vote=Exists(
                ReviewVote.objects.filter(user=request_user, review=OuterRef("pk"), is_helpful=True)
            )
        )

    anime_slug = query_params.get("anime")
    if anime_slug:
        queryset = queryset.filter(anime__slug=anime_slug)

    target_username = query_params.get("user")
    if target_username:
        queryset = queryset.filter(user__username=target_username)

    if query_params.get("mine") == "true" and request_user.is_authenticated:
        queryset = queryset.filter(user=request_user)

    rating_filter = query_params.get("rating")
    if rating_filter:
        try:
            stars = int(rating_filter)
        except ValueError:
            stars = None

        if stars is not None:
            min_rating = (stars - 1) * 2 + 1
            max_rating = stars * 2
            queryset = queryset.filter(rating__gte=min_rating, rating__lte=max_rating)

    sort = query_params.get("sort", "helpful")
    if sort == "highest":
        return queryset.order_by("-rating", "-created_at")
    if sort == "lowest":
        return queryset.order_by("rating", "-created_at")
    if sort == "newest":
        return queryset.order_by("-created_at")
    return queryset.order_by("-_helpful_count", "-created_at")


def get_review_stats(anime_slug):
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
        return {
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
    return {"total_reviews": total, "distribution": distribution, "averages": averages}


def create_review(serializer, user):
    ensure_reviews_enabled()
    anime = serializer.validated_data.get("anime")
    if not anime:
        raise serializers.ValidationError({"non_field_errors": ["Anime not found."]})

    if not UserAnimeList.objects.filter(user=user, anime=anime).exists():
        raise serializers.ValidationError(
            {"non_field_errors": ["You must add this anime to your list before writing a review."]}
        )

    try:
        serializer.save(user=user)
        invalidate_user_caches(user.id, user.username)
    except IntegrityError as exc:
        raise serializers.ValidationError(
            {"non_field_errors": ["You have already reviewed this anime."]}
        ) from exc


def update_review(serializer, user):
    ensure_reviews_enabled()
    if serializer.instance.user != user:
        raise PermissionDenied("You can only edit your own reviews.")
    serializer.save()
    invalidate_user_caches(user.id, user.username)


def delete_review(instance, user):
    ensure_reviews_enabled()
    if instance.user != user:
        raise PermissionDenied("You can only delete your own reviews.")
    instance.delete()
    invalidate_user_caches(user.id, user.username)


def vote_on_review(review, user, is_helpful):
    ensure_reviews_enabled()
    if review.user == user:
        return ReviewActionResult(
            payload={"error": "Cannot vote on your own review"},
            status_code=400,
        )

    existing_vote = ReviewVote.objects.filter(user=user, review=review).first()
    if existing_vote:
        if existing_vote.is_helpful == is_helpful:
            existing_vote.delete()
            return ReviewActionResult(
                payload={"voted": False, "is_helpful": None},
                status_code=200,
            )
        existing_vote.is_helpful = is_helpful
        existing_vote.save()
        return ReviewActionResult(
            payload={"voted": True, "is_helpful": is_helpful},
            status_code=200,
        )

    ReviewVote.objects.create(user=user, review=review, is_helpful=is_helpful)
    return ReviewActionResult(
        payload={"voted": True, "is_helpful": is_helpful},
        status_code=200,
    )


def get_review_comments(review, page, page_size):
    comments = (
        review.comments.filter(is_deleted=False)
        .select_related("user", "user__userprofile", "review__user")
        .order_by("-created_at")
    )
    start = (page - 1) * page_size
    end = start + page_size
    total = comments.count()
    return comments[start:end], total


def add_review_comment(review, user, text):
    ensure_comments_enabled()
    normalized_text = (text or "").strip()
    if not normalized_text:
        return ReviewActionResult(
            payload={"text": ["Comment text is required."]},
            status_code=400,
        )

    comment = ReviewComment.objects.create(user=user, review=review, text=normalized_text)
    return ReviewActionResult(payload={"comment": comment}, status_code=201)


def update_review_comment(review, comment_id, user, text):
    ensure_comments_enabled()
    try:
        comment = review.comments.get(id=comment_id)
    except ReviewComment.DoesNotExist:
        return ReviewActionResult(payload={"detail": "Comment not found."}, status_code=404)

    if comment.user != user:
        raise PermissionDenied("You can only edit your own comments.")

    normalized_text = (text or "").strip()
    if not normalized_text:
        return ReviewActionResult(
            payload={"text": ["Comment text is required."]},
            status_code=400,
        )

    comment.text = normalized_text
    comment.save()
    return ReviewActionResult(payload={"comment": comment}, status_code=200)


def delete_review_comment(review, comment_id, user):
    try:
        comment = review.comments.get(id=comment_id)
    except ReviewComment.DoesNotExist:
        return ReviewActionResult(payload={"detail": "Comment not found."}, status_code=404)

    if comment.user != user and review.user != user:
        raise PermissionDenied("You don't have permission to delete this comment.")

    comment.soft_delete()
    return ReviewActionResult(payload={"deleted": True}, status_code=200)


def report_review(review, user, validated_data):
    ensure_reviews_enabled()
    if review.user_id == user.id:
        return ReviewActionResult(
            payload={"error": "You cannot report your own review."},
            status_code=400,
        )

    report, created = ReviewReport.objects.update_or_create(
        review=review,
        reporter=user,
        defaults={
            "reason": validated_data["reason"],
            "description": validated_data.get("description", "").strip(),
            "status": ReviewReport.Status.OPEN,
            "resolved_by": None,
            "resolved_at": None,
            "resolution_notes": "",
        },
    )
    return ReviewActionResult(
        payload={
            "id": report.id,
            "review_id": review.id,
            "status": report.status,
            "created": created,
        },
        status_code=201 if created else 200,
    )
