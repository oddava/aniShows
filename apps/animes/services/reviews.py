from dataclasses import dataclass
from datetime import timedelta

from allauth.socialaccount.models import SocialAccount
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import (
    Avg,
    Count,
    Exists,
    FloatField,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Subquery,
    Value,
)
from django.db.models.functions import Cast, Coalesce, NullIf, Sqrt
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from ...core.models import Notification
from ...core.services.admin_settings_service import are_reviews_enabled
from ...core.services.notification_service import notify, retract
from ...shared.public_cache import get_or_build_public_payload, invalidate_public_cache_keys
from ...users.models import UserAnimeList
from ...users.services.cache import invalidate_user_caches
from ...users.services.profile_visibility import can_view_profile
from ..models import Anime, Review, ReviewReaction, ReviewReport, ReviewVote
from ..serializers.reviews import wants_compact_anime

User = get_user_model()

REVIEW_STATS_CACHE_TTL = 300
# z for a 95% confidence interval, used by the "Most helpful" Wilson lower bound.
WILSON_Z = 1.96

POSITIVE_REVIEW_REACTIONS = {
    ReviewReaction.ReactionType.THUMBS_UP,
    ReviewReaction.ReactionType.HEART,
}
ACTIVE_REPORT_STATUSES = (ReviewReport.Status.OPEN, ReviewReport.Status.IN_REVIEW)


@dataclass(slots=True)
class ReviewActionResult:
    payload: dict
    status_code: int


def ensure_reviews_enabled():
    if not are_reviews_enabled():
        raise PermissionDenied("Reviews are currently disabled by the administrator.")


# --- Read side -----------------------------------------------------------------


def _base_review_queryset(*, compact_anime: bool) -> QuerySet:
    queryset = Review.objects.select_related("user", "user__userprofile", "anime")
    if not compact_anime:
        # ``AnimeListSerializer`` nests the genres and the primary studio.
        queryset = queryset.prefetch_related("anime__genres", Anime.studios_prefetch("anime__"))
    return queryset.prefetch_related(
        Prefetch(
            "user__socialaccount_set",
            queryset=SocialAccount.objects.filter(provider="google").only(
                "user_id", "provider", "extra_data"
            ),
            to_attr="_prefetched_social_accounts",
        ),
    )


def _per_review_count(model, **filters) -> Coalesce:
    """A correlated ``COUNT(*)`` of ``model`` rows for the outer review (no join, no GROUP BY)."""
    counts = (
        model.objects.filter(review=OuterRef("pk"), **filters)
        .order_by()
        .values("review")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(counts, output_field=IntegerField()), Value(0))


def _count_annotations() -> dict:
    annotations = {
        "_helpful_count": _per_review_count(ReviewVote, vote_type=ReviewVote.VoteType.HELPFUL),
        "_dislike_count": _per_review_count(ReviewVote, vote_type=ReviewVote.VoteType.DISLIKE),
    }
    annotations.update(
        {
            f"_reaction_count_{reaction_type}": _per_review_count(
                ReviewReaction, reaction_type=reaction_type
            )
            for reaction_type in ReviewReaction.ReactionType.values
        }
    )
    return annotations


def _viewer_review_annotations(request_user) -> dict:
    if not request_user.is_authenticated:
        return {}

    annotations = {
        f"_user_{vote_type}_vote": Exists(
            ReviewVote.objects.filter(user=request_user, review=OuterRef("pk"), vote_type=vote_type)
        )
        for vote_type in ReviewVote.VoteType.values
    }
    annotations.update(
        {
            f"_reaction_active_{reaction_type}": Exists(
                ReviewReaction.objects.filter(
                    user=request_user,
                    review=OuterRef("pk"),
                    reaction_type=reaction_type,
                )
            )
            for reaction_type in ReviewReaction.ReactionType.values
        }
    )
    return annotations


def _filter_by_author(queryset: QuerySet, request_user, username: str) -> QuerySet:
    """``?user=``: a private profile's reviews are listed to its owner only."""
    author = User.objects.select_related("userprofile").filter(username=username).first()
    if author is None or not can_view_profile(author, request_user):
        return queryset.none()
    return queryset.filter(user=author)


def _apply_review_filters(queryset, request_user, query_params):
    anime_slug = query_params.get("anime")
    if anime_slug:
        queryset = queryset.filter(anime__slug=anime_slug)

    target_username = query_params.get("user")
    if target_username:
        queryset = _filter_by_author(queryset, request_user, target_username)

    if query_params.get("mine") == "true" and request_user.is_authenticated:
        queryset = queryset.filter(user=request_user)

    rating_filter = query_params.get("rating")
    if not rating_filter:
        return queryset

    try:
        stars = int(rating_filter)
    except ValueError:
        return queryset

    min_rating = (stars - 1) * 2 + 1
    max_rating = stars * 2
    return queryset.filter(rating__gte=min_rating, rating__lte=max_rating)


def _wilson_lower_bound() -> Coalesce:
    """95% Wilson lower bound of helpful among helpful + dislike votes (0 without votes).

    With h helpful, d dislike and n = h + d:
    (h + z^2/2 - z * sqrt(h*d/n + z^2/4)) / (n + z^2).
    """
    helpful = Cast("_helpful_count", FloatField())
    dislike = Cast("_dislike_count", FloatField())
    total = helpful + dislike
    z_squared = WILSON_Z * WILSON_Z
    spread = Sqrt(helpful * dislike / NullIf(total, Value(0.0)) + Value(z_squared / 4))
    bound = (helpful + Value(z_squared / 2) - Value(WILSON_Z) * spread) / (total + Value(z_squared))
    return Coalesce(bound, Value(0.0), output_field=FloatField())


def _order_reviews(queryset, query_params):
    sort = query_params.get("sort", "helpful")
    if sort == "highest":
        return queryset.order_by("-rating", "-created_at")
    if sort == "lowest":
        return queryset.order_by("rating", "-created_at")
    if sort == "newest":
        return queryset.order_by("-created_at")
    return queryset.alias(_helpfulness=_wilson_lower_bound()).order_by(
        "-_helpfulness", "-created_at"
    )


def get_review_queryset(request_user, query_params):
    queryset = _base_review_queryset(compact_anime=wants_compact_anime(query_params)).annotate(
        **_count_annotations(),
        **_viewer_review_annotations(request_user),
        _is_completed=Exists(
            UserAnimeList.objects.filter(
                user=OuterRef("user"),
                anime=OuterRef("anime"),
                status=UserAnimeList.UserAnimeStatus.completed,
            )
        ),
    )
    queryset = _apply_review_filters(queryset, request_user, query_params)
    return _order_reviews(queryset, query_params)


def get_interaction_review_queryset() -> QuerySet:
    """Reviews for the vote / reaction / report actions (only the author is needed)."""
    return Review.objects.select_related("user")


def get_review_interaction_state(review_id: int, request_user) -> Review:
    """The review with fresh counts and ``request_user``'s votes and reactions annotated."""
    return Review.objects.annotate(
        **_count_annotations(), **_viewer_review_annotations(request_user)
    ).get(pk=review_id)


def review_stats_cache_key(anime_slug: str) -> str:
    return f"review_stats:{anime_slug}"


def invalidate_review_stats(anime_slug: str) -> None:
    invalidate_public_cache_keys(review_stats_cache_key(anime_slug))


def _build_review_stats(anime_slug: str) -> dict:
    stats = Review.objects.filter(anime__slug=anime_slug).aggregate(
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


def get_review_stats(anime_slug: str) -> dict:
    """Rating summary for one anime, cached for 5 minutes and dropped on any review change."""
    payload, _cache_status = get_or_build_public_payload(
        review_stats_cache_key(anime_slug),
        lambda: _build_review_stats(anime_slug),
        ttl=REVIEW_STATS_CACHE_TTL,
    )
    return payload


# --- Write side ----------------------------------------------------------------


def create_review(serializer, user):
    ensure_reviews_enabled()
    anime = serializer.validated_data.get("anime")
    if not anime:
        raise ValidationError({"non_field_errors": ["Anime not found."]})

    if not UserAnimeList.objects.filter(user=user, anime=anime).exists():
        raise ValidationError(
            {"non_field_errors": ["You must add this anime to your list before writing a review."]}
        )

    try:
        with transaction.atomic():
            serializer.save(user=user)
            transaction.on_commit(lambda: invalidate_user_caches(user.id, user.username))
    except IntegrityError as exc:
        raise ValidationError(
            {"non_field_errors": ["You have already reviewed this anime."]}
        ) from exc


def update_review(serializer, user):
    ensure_reviews_enabled()
    if serializer.instance.user != user:
        raise PermissionDenied("You can only edit your own reviews.")
    try:
        with transaction.atomic():
            serializer.save()
            transaction.on_commit(lambda: invalidate_user_caches(user.id, user.username))
    except IntegrityError as exc:
        raise ValidationError({"non_field_errors": ["This review could not be saved."]}) from exc


def delete_review(instance, user):
    ensure_reviews_enabled()
    if instance.user != user:
        raise PermissionDenied("You can only delete your own reviews.")
    with transaction.atomic():
        instance.delete()
        transaction.on_commit(lambda: invalidate_user_caches(user.id, user.username))


def _has_active_review_like_signal(review: Review, user) -> bool:
    return (
        ReviewVote.objects.filter(
            user=user, review=review, vote_type=ReviewVote.VoteType.HELPFUL
        ).exists()
        or ReviewReaction.objects.filter(
            user=user, review=review, reaction_type__in=POSITIVE_REVIEW_REACTIONS
        ).exists()
    )


def _sync_review_like_notification(review: Review, actor, *, liked_before: bool) -> None:
    """Notify the author when ``actor`` starts liking the review; retract when they stop.

    A helpful vote and the positive reactions all count as one "like", so only a
    change of that combined state reaches the author (never a second notification).
    """
    liked_now = _has_active_review_like_signal(review, actor)
    if liked_now == liked_before:
        return
    group_key = f"review_like:{review.pk}"
    notification_type = Notification.NotificationType.REVIEW_LIKE
    if liked_now:
        notify(
            review.user,
            notification_type,
            actor=actor,
            data={"review_id": review.pk},
            group_key=group_key,
        )
    else:
        retract(review.user, notification_type, actor=actor, group_key=group_key)


def _toggle_vote(review: Review, user, vote_type: str) -> bool:
    """Add, switch or remove ``user``'s vote; return whether ``vote_type`` is now active."""
    vote = ReviewVote.objects.select_for_update().filter(user=user, review=review).first()
    if vote is None:
        ReviewVote.objects.create(user=user, review=review, vote_type=vote_type)
        return True
    vote.review = review
    if vote.vote_type == vote_type:
        vote.delete()
        return False
    vote.vote_type = vote_type
    vote.save(update_fields=["vote_type"])
    return True


def vote_on_review(review, user, vote_type):
    ensure_reviews_enabled()
    if review.user_id == user.id:
        return ReviewActionResult(
            payload={"error": "Cannot vote on your own review"},
            status_code=400,
        )

    liked_before = _has_active_review_like_signal(review, user)
    try:
        with transaction.atomic():
            active = _toggle_vote(review, user, vote_type)
    except IntegrityError:
        # A parallel request by the same user created the vote first (unique pair).
        active = ReviewVote.objects.filter(user=user, review=review, vote_type=vote_type).exists()
    _sync_review_like_notification(review, user, liked_before=liked_before)
    return ReviewActionResult(
        payload={"active": active, "vote_type": vote_type},
        status_code=200,
    )


def _toggle_reaction(review: Review, user, reaction_type: str) -> bool:
    """Add or remove one reaction; return whether it is now active."""
    deleted, _ = ReviewReaction.objects.filter(
        user=user, review=review, reaction_type=reaction_type
    ).delete()
    if deleted:
        return False
    ReviewReaction.objects.create(user=user, review=review, reaction_type=reaction_type)
    return True


def toggle_review_reaction(review, user, reaction_type):
    ensure_reviews_enabled()
    if review.user_id == user.id:
        return ReviewActionResult(
            payload={"detail": "You cannot react to your own review.", "code": "own_review"},
            status_code=400,
        )

    positive = reaction_type in POSITIVE_REVIEW_REACTIONS
    liked_before = positive and _has_active_review_like_signal(review, user)
    try:
        with transaction.atomic():
            active = _toggle_reaction(review, user, reaction_type)
    except IntegrityError:
        # A parallel request by the same user added this reaction first.
        active = True
    if positive:
        _sync_review_like_notification(review, user, liked_before=liked_before)
    return ReviewActionResult(
        payload={"active": active, "reaction_type": reaction_type},
        status_code=200,
    )


def _report_payload(report: ReviewReport, *, created: bool) -> dict:
    return {
        "id": report.id,
        "review_id": report.review_id,
        "status": report.status,
        "created": created,
    }


def _daily_report_limit_reached(user) -> bool:
    since = timezone.now() - timedelta(days=1)
    filed = ReviewReport.objects.filter(reporter=user, created_at__gte=since).count()
    return filed >= settings.REVIEW_REPORTS_PER_DAY


def _refresh_open_report(report: ReviewReport, reason: str, description: str) -> ReviewReport:
    """Update an open / in-review report's text; a moderator's decision is never reopened."""
    if report.status in ACTIVE_REPORT_STATUSES:
        updated = ReviewReport.objects.filter(
            pk=report.pk, status__in=ACTIVE_REPORT_STATUSES
        ).update(reason=reason, description=description, updated_at=timezone.now())
        if not updated:
            # A moderator closed it in the meantime; answer with their decision.
            report.refresh_from_db(fields=["status"])
    return report


def report_review(review, user, validated_data):
    ensure_reviews_enabled()
    if review.user_id == user.id:
        return ReviewActionResult(
            payload={"error": "You cannot report your own review."},
            status_code=400,
        )

    reason = validated_data["reason"]
    description = validated_data.get("description", "").strip()
    report = ReviewReport.objects.filter(review=review, reporter=user).first()
    if report is None:
        if _daily_report_limit_reached(user):
            return ReviewActionResult(
                payload={
                    "detail": "You have reached the daily report limit. Try again tomorrow.",
                    "code": "report_limit",
                },
                status_code=429,
            )
        try:
            with transaction.atomic():
                report = ReviewReport.objects.create(
                    review=review, reporter=user, reason=reason, description=description
                )
            return ReviewActionResult(
                payload=_report_payload(report, created=True), status_code=201
            )
        except IntegrityError:
            # A parallel request filed it first; treat this one as a re-report.
            report = ReviewReport.objects.get(review=review, reporter=user)

    report = _refresh_open_report(report, reason, description)
    return ReviewActionResult(payload=_report_payload(report, created=False), status_code=200)
