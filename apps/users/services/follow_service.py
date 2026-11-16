from collections.abc import Sequence
from dataclasses import dataclass

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, QuerySet, Window
from django.http import Http404
from rest_framework.exceptions import PermissionDenied, ValidationError

from ...shared.logger import logger
from ..models import UserAnimeList, UserFollow
from .cache import invalidate_user_caches
from .profile_visibility import can_view_profile

User = get_user_model()

FRIENDS_WATCHING_LIMIT = 50
# Shorter ``?search=`` terms are ignored (they would match nearly everyone).
MIN_SEARCH_LENGTH = 2


@dataclass(slots=True)
class FollowActionResult:
    payload: dict
    status_code: int


@dataclass(frozen=True, slots=True)
class FriendsWatching:
    results: Sequence[UserAnimeList]
    total: int


def google_accounts_prefetch(lookup: str) -> Prefetch:
    return Prefetch(
        f"{lookup}__socialaccount_set",
        queryset=SocialAccount.objects.filter(provider="google").only(
            "user_id", "provider", "extra_data"
        ),
        to_attr="_prefetched_social_accounts",
    )


def get_target_user(username):
    try:
        return User.objects.select_related("userprofile").get(username=username)
    except User.DoesNotExist as exc:
        raise Http404 from exc


def ensure_profile_visible(target_user, request_user):
    # 403 (not G1's 404) is this endpoint family's established answer for private lists.
    if not can_view_profile(target_user, request_user):
        raise PermissionDenied("This profile is private.")


def _search_by_username(queryset: QuerySet, user_field: str, search: str | None) -> QuerySet:
    term = (search or "").strip()
    if len(term) < MIN_SEARCH_LENGTH:
        return queryset
    return queryset.filter(**{f"{user_field}__username__icontains": term})


def toggle_follow(user, username) -> FollowActionResult:
    if not user.is_authenticated:
        return FollowActionResult(
            payload={"detail": "Authentication required.", "code": "not_authenticated"},
            status_code=401,
        )

    target_user = get_target_user(username)
    if target_user == user:
        return FollowActionResult(
            payload={"detail": "You cannot follow yourself.", "code": "cannot_follow_self"},
            status_code=400,
        )

    try:
        with transaction.atomic():
            follow, created = UserFollow.objects.get_or_create(follower=user, following=target_user)
    except IntegrityError:
        # A concurrent request (a double click) created it first: the user
        # wants to follow, so that is the outcome, not a 500.
        created = True
    else:
        if not created:
            follow.delete()

    logger.info(
        "%s %s %s", user.username, "followed" if created else "unfollowed", target_user.username
    )
    invalidate_user_caches(target_user.id, target_user.username)
    invalidate_user_caches(user.id, user.username)

    # Two separate counts: one aggregate over both reverse relations would multiply rows.
    return FollowActionResult(
        payload={
            "status": "followed" if created else "unfollowed",
            "is_following": created,
            "followers_count": UserFollow.objects.filter(following=target_user).count(),
            "following_count": UserFollow.objects.filter(follower=user).count(),
        },
        status_code=201 if created else 200,
    )


def get_followers_queryset(username, request_user, search: str | None = None):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = (
        _search_by_username(UserFollow.objects.filter(following=target_user), "follower", search)
        .select_related("follower__userprofile")
        .prefetch_related(google_accounts_prefetch("follower"))
    )

    if request_user.is_authenticated:
        queryset = queryset.annotate(
            _is_following=Exists(
                UserFollow.objects.filter(follower=request_user, following=OuterRef("follower"))
            ),
            _is_follower=Exists(
                UserFollow.objects.filter(follower=OuterRef("follower"), following=request_user)
            ),
        )

    return queryset


def get_following_queryset(username, request_user, search: str | None = None):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = (
        _search_by_username(UserFollow.objects.filter(follower=target_user), "following", search)
        .select_related("following__userprofile")
        .prefetch_related(google_accounts_prefetch("following"))
    )

    if request_user.is_authenticated:
        queryset = queryset.annotate(
            _is_following=Exists(
                UserFollow.objects.filter(follower=request_user, following=OuterRef("following"))
            ),
            _is_follower=Exists(
                UserFollow.objects.filter(follower=OuterRef("following"), following=request_user)
            ),
        )

    return queryset


def get_mutuals_queryset(username, request_user, search: str | None = None):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = (
        _search_by_username(
            UserFollow.objects.filter(
                follower=target_user,
                following__following__following=target_user,
            ),
            "following",
            search,
        )
        .select_related("following__userprofile")
        .prefetch_related(google_accounts_prefetch("following"))
        .order_by("-created_at")
    )

    if request_user.is_authenticated:
        queryset = queryset.annotate(
            _is_following=Exists(
                UserFollow.objects.filter(follower=request_user, following=OuterRef("following"))
            ),
            _is_follower=Exists(
                UserFollow.objects.filter(follower=OuterRef("following"), following=request_user)
            ),
        )

    return queryset


def is_following(request_user, username):
    target_user = get_target_user(username)
    return UserFollow.objects.filter(follower=request_user, following=target_user).exists()


def mutual_follow_ids(user) -> QuerySet:
    """Ids of the users ``user`` follows who follow ``user`` back (a subquery)."""
    followers = UserFollow.objects.filter(following=user).values("follower_id")
    return UserFollow.objects.filter(follower=user, following_id__in=followers).values(
        "following_id"
    )


def get_friends_watching(request_user, anime_id) -> FriendsWatching:
    """List entries of ``anime_id`` by mutual follows (newest first, capped) and their total."""
    if not anime_id:
        raise ValidationError({"detail": "anime_id parameter is required."})

    try:
        resolved_anime_id = int(anime_id)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"detail": "anime_id must be an integer."}) from exc

    entries = list(
        UserAnimeList.objects.filter(
            anime_id=resolved_anime_id,
            user_id__in=mutual_follow_ids(request_user),
        )
        # Private lists are hidden from everyone else, mutual followers included.
        .exclude(user__userprofile__is_private=True)
        .select_related("user__userprofile", "anime")
        .prefetch_related(google_accounts_prefetch("user"))
        # The full count rides along on every row (no second query).
        .annotate(_total=Window(Count("id")))
        .order_by("-updated_at")[:FRIENDS_WATCHING_LIMIT]
    )
    return FriendsWatching(results=entries, total=entries[0]._total if entries else 0)
