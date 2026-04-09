from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, Exists, F, OuterRef, Prefetch, Q, Subquery, Sum
from django.db.models.functions import Coalesce

from ...animes.models import ReviewVote
from ..models import UserAnimeList, UserBadge, UserFollow

User = get_user_model()


def get_annotated_user_queryset(user=None, lightweight=False):
    """Return a user queryset with performance annotations for profile views."""
    queryset = User.objects.select_related("userprofile").prefetch_related(
        Prefetch(
            "badges",
            queryset=UserBadge.objects.filter(badge__is_active=True, is_featured=True)
            .select_related("badge")
            .order_by("-granted_at")[:3],
            to_attr="_prefetched_badges",
        ),
        Prefetch(
            "socialaccount_set",
            queryset=SocialAccount.objects.filter(provider="google").only(
                "user_id", "provider", "extra_data"
            ),
            to_attr="_prefetched_social_accounts",
        ),
    )

    queryset = queryset.annotate(
        _followers_count=Count("followers", distinct=True),
        _following_count=Count("following", distinct=True),
        _anime_count=Count("anime_lists", distinct=True),
    )

    if not lightweight:
        queryset = queryset.annotate(
            _favorites_count=Count("favorites", distinct=True),
            _reviews_count=Count("reviews", distinct=True),
            _resonance_count=Count(
                "reviews__votes",
                filter=Q(reviews__votes__vote_type=ReviewVote.VoteType.HELPFUL),
                distinct=True,
            ),
        )

        episodes_subquery = (
            UserAnimeList.objects.filter(user=OuterRef("pk"))
            .values("user")
            .annotate(total=Sum("episodes_watched"))
            .values("total")
        )
        queryset = queryset.annotate(_episodes_watched=Coalesce(Subquery(episodes_subquery), 0))

        total_minutes_subquery = (
            UserAnimeList.objects.filter(user=OuterRef("pk"))
            .annotate(entry_minutes=F("episodes_watched") * F("anime__duration_minutes"))
            .values("user")
            .annotate(total=Sum("entry_minutes"))
            .values("total")
        )
        queryset = queryset.annotate(_total_minutes=Coalesce(Subquery(total_minutes_subquery), 0))

        queryset = queryset.annotate(
            _mean_score_raw=Avg("anime_lists__score", filter=Q(anime_lists__score__gt=0))
        )
        queryset = queryset.annotate(_days_watched=Coalesce(F("_total_minutes"), 0) / 1440.0)

    if user and user.is_authenticated:
        queryset = queryset.annotate(
            _is_following=Exists(UserFollow.objects.filter(follower=user, following=OuterRef("pk")))
        )

    return queryset
