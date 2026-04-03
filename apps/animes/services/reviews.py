from dataclasses import dataclass

from allauth.socialaccount.models import SocialAccount
from django.db import IntegrityError
from django.db.models import Avg, Count, Exists, OuterRef, Prefetch, Q
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.animes.models import Review, ReviewReaction, ReviewReport, ReviewVote
from apps.core.services.admin_settings_service import are_reviews_enabled
from apps.users.models import UserAnimeList
from apps.users.services.cache import invalidate_user_caches


@dataclass(slots=True)
class ReviewActionResult:
    payload: dict
    status_code: int


def ensure_reviews_enabled():
    if not are_reviews_enabled():
        raise PermissionDenied("Reviews are currently disabled by the administrator.")


def get_review_queryset(request_user, query_params):
    queryset = Review.objects.select_related(
        "user",
        "user__userprofile",
        "anime",
        "anime__studio",
    ).prefetch_related(
        "anime__genres",
        Prefetch(
            "user__socialaccount_set",
            queryset=SocialAccount.objects.filter(provider="google").only(
                "user_id", "provider", "extra_data"
            ),
            to_attr="_prefetched_social_accounts",
        ),
    )
    queryset = queryset.annotate(
        _helpful_count=Count(
            "votes",
            filter=Q(votes__vote_type=ReviewVote.VoteType.HELPFUL),
            distinct=True,
        ),
        _dislike_count=Count(
            "votes",
            filter=Q(votes__vote_type=ReviewVote.VoteType.DISLIKE),
            distinct=True,
        ),
    )

    reaction_annotations = {}
    for reaction_type in ReviewReaction.ReactionType.values:
        reaction_annotations[f"_reaction_count_{reaction_type}"] = Count(
            "reactions",
            filter=Q(reactions__reaction_type=reaction_type),
            distinct=True,
        )
    queryset = queryset.annotate(**reaction_annotations)

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
        vote_annotations = {
            "_user_helpful_vote": Exists(
                ReviewVote.objects.filter(
                    user=request_user,
                    review=OuterRef("pk"),
                    vote_type=ReviewVote.VoteType.HELPFUL,
                )
            ),
            "_user_dislike_vote": Exists(
                ReviewVote.objects.filter(
                    user=request_user,
                    review=OuterRef("pk"),
                    vote_type=ReviewVote.VoteType.DISLIKE,
                )
            ),
        }
        reaction_active_annotations = {}
        for reaction_type in ReviewReaction.ReactionType.values:
            reaction_active_annotations[f"_reaction_active_{reaction_type}"] = Exists(
                ReviewReaction.objects.filter(
                    user=request_user,
                    review=OuterRef("pk"),
                    reaction_type=reaction_type,
                )
            )
        queryset = queryset.annotate(**vote_annotations, **reaction_active_annotations)

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


def vote_on_review(review, user, vote_type):
    ensure_reviews_enabled()
    if review.user == user:
        return ReviewActionResult(
            payload={"error": "Cannot vote on your own review"},
            status_code=400,
        )

    existing_vote = ReviewVote.objects.filter(
        user=user,
        review=review,
        vote_type=vote_type,
    ).first()
    if existing_vote:
        existing_vote.delete()
        return ReviewActionResult(
            payload={"active": False, "vote_type": vote_type},
            status_code=200,
        )

    ReviewVote.objects.create(user=user, review=review, vote_type=vote_type)
    return ReviewActionResult(
        payload={"active": True, "vote_type": vote_type},
        status_code=200,
    )


def toggle_review_reaction(review, user, reaction_type):
    ensure_reviews_enabled()
    existing_reaction = ReviewReaction.objects.filter(
        user=user,
        review=review,
        reaction_type=reaction_type,
    ).first()
    if existing_reaction:
        existing_reaction.delete()
        return ReviewActionResult(
            payload={"active": False, "reaction_type": reaction_type},
            status_code=200,
        )

    ReviewReaction.objects.create(user=user, review=review, reaction_type=reaction_type)
    return ReviewActionResult(
        payload={"active": True, "reaction_type": reaction_type},
        status_code=200,
    )


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
