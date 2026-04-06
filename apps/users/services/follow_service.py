from dataclasses import dataclass

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db import models, transaction
from django.db.models import Count, Exists, OuterRef, Prefetch
from django.http import Http404
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.shared.logger import logger
from apps.users.models import UserAnimeList, UserFollow
from apps.users.services.cache import invalidate_user_caches

User = get_user_model()


@dataclass(slots=True)
class FollowActionResult:
    payload: dict
    status_code: int


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
    profile = getattr(target_user, "userprofile", None)
    if profile and profile.is_private and (
        not request_user.is_authenticated or target_user != request_user
    ):
        raise PermissionDenied("This profile is private.")


def toggle_follow(user, username) -> FollowActionResult:
    if not user.is_authenticated:
        return FollowActionResult(
            payload={"detail": "Authentication required."},
            status_code=401,
        )

    target_user = get_target_user(username)
    if target_user == user:
        return FollowActionResult(
            payload={"detail": "You cannot follow yourself."},
            status_code=400,
        )

    with transaction.atomic():
        locked_users = User.objects.select_for_update().filter(pk__in=[user.pk, target_user.pk]).in_bulk()
        acting_user = locked_users[user.pk]
        locked_target_user = locked_users[target_user.pk]

        follow = UserFollow.objects.select_for_update().filter(
            follower=acting_user,
            following=locked_target_user,
        ).first()
        if follow:
            follow.delete()
            status_code = 200
            payload_status = "unfollowed"
            is_following = False
            logger.info("%s unfollowed %s", acting_user.username, locked_target_user.username)
        else:
            UserFollow.objects.create(follower=acting_user, following=locked_target_user)
            status_code = 201
            payload_status = "followed"
            is_following = True
            logger.info("%s followed %s", acting_user.username, locked_target_user.username)

        counts = User.objects.filter(pk__in=[locked_target_user.pk, acting_user.pk]).aggregate(
            target_followers=Count("followers", filter=models.Q(pk=locked_target_user.pk)),
            user_following=Count("following", filter=models.Q(pk=acting_user.pk)),
        )

        transaction.on_commit(lambda: invalidate_user_caches(locked_target_user.id, locked_target_user.username))
        transaction.on_commit(lambda: invalidate_user_caches(acting_user.id, acting_user.username))

    return FollowActionResult(
        payload={
            "status": payload_status,
            "is_following": is_following,
            "followers_count": counts["target_followers"],
            "following_count": counts["user_following"],
        },
        status_code=status_code,
    )


def get_followers_queryset(username, request_user):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = UserFollow.objects.filter(following=target_user).select_related(
        "follower__userprofile"
    ).prefetch_related(google_accounts_prefetch("follower"))

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


def get_following_queryset(username, request_user):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = UserFollow.objects.filter(follower=target_user).select_related(
        "following__userprofile"
    ).prefetch_related(google_accounts_prefetch("following"))

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


def get_mutuals_queryset(username, request_user):
    target_user = get_target_user(username)
    ensure_profile_visible(target_user, request_user)

    queryset = (
        UserFollow.objects.filter(
            follower=target_user,
            following__following__following=target_user,
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


def get_friends_watching_queryset(request_user, anime_id):
    if not anime_id:
        raise ValidationError({"detail": "anime_id parameter is required."})

    try:
        resolved_anime_id = int(anime_id)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"detail": "anime_id must be an integer."}) from exc

    return (
        UserAnimeList.objects.filter(
            anime_id=resolved_anime_id,
            user__followers__follower=request_user,
            user__following__following=request_user,
        )
        .select_related("user__userprofile", "anime")
        .prefetch_related(google_accounts_prefetch("user"))
        .order_by("-updated_at")[:50]
    )
