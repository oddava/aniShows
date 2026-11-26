"""The admin user page's extra sections, and the users CSV export."""

from __future__ import annotations

import csv
import io

from allauth.socialaccount.models import SocialAccount
from django.db.models import Count

from ...animes.models import Review, UserFavorite
from ...forums.models import Post, Thread
from ...shared.media_urls import field_media_url
from ...users.models import UserAnimeList, UserBadge, UserFollow
from .query_helpers import related_count

SNIPPET_LENGTH = 200
RECENT_LIMIT = 5
EXPORT_MAX_ROWS = 10_000
EXPORT_COLUMNS = (
    "id",
    "username",
    "email",
    "date_joined",
    "last_login",
    "is_active",
    "is_staff",
    "is_superuser",
    "email_verified",
    "list_entries",
    "reviews",
    "favorites",
)
# A cell starting with one of these is a formula to a spreadsheet (CSV injection).
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _iso(value):
    return value.isoformat() if value else None


def _profile_section(user) -> dict:
    profile = getattr(user, "userprofile", None)
    if profile is None:
        return {
            "bio": "",
            "avatar": None,
            "banner": None,
            "is_private": False,
            "email_verified": False,
            "points": 0,
            "last_activity": None,
            "preferred_timezone": "",
            "pending_email": "",
        }
    return {
        "bio": profile.bio or "",
        "avatar": field_media_url(profile.avatar),
        "banner": field_media_url(profile.banner),
        "is_private": profile.is_private,
        "email_verified": profile.email_verified,
        "points": profile.points,
        "last_activity": _iso(profile.last_activity),
        "preferred_timezone": profile.preferred_timezone or "",
        "pending_email": profile.pending_email or "",
    }


def user_detail_extras(user) -> dict:
    """Profile, counts, list breakdown, recent content, badges and sign-in providers."""
    model = type(user)
    counts = {
        "list_entries": related_count(UserAnimeList, "user"),
        "reviews": related_count(Review, "user"),
        "favorites": related_count(UserFavorite, "user"),
        "followers": related_count(UserFollow, "following"),
        "following": related_count(UserFollow, "follower"),
        "forum_threads": related_count(Thread, "author"),
        "forum_posts": related_count(Post, "author"),
        "badges": related_count(UserBadge, "user"),
    }
    # Aliased: several names ("reviews", "badges", ...) are reverse relations on the user.
    row = (
        model.objects.filter(pk=user.pk)
        .annotate(**{f"_n_{name}": expression for name, expression in counts.items()})
        .values(*(f"_n_{name}" for name in counts))
        .get()
    )
    stats = {name: row[f"_n_{name}"] for name in counts}
    breakdown = dict(
        UserAnimeList.objects.filter(user=user)
        .values_list("status")
        .annotate(total=Count("id"))
        .order_by()
    )
    reviews = Review.objects.filter(user=user).select_related("anime").order_by("-created_at")
    threads = Thread.objects.filter(author=user).order_by("-created_at")
    badges = UserBadge.objects.filter(user=user).select_related("badge").order_by("-granted_at")
    providers = sorted(
        set(SocialAccount.objects.filter(user=user).values_list("provider", flat=True))
    )
    return {
        "profile": _profile_section(user),
        "stats": stats,
        "list_breakdown": breakdown,
        "recent_reviews": [
            {
                "id": review.id,
                "anime": {
                    "id": review.anime_id,
                    "title": review.anime.title,
                    "slug": review.anime.slug,
                },
                "rating": review.rating,
                "snippet": (review.text or "")[:SNIPPET_LENGTH],
                "has_spoilers": review.has_spoilers,
                "created_at": _iso(review.created_at),
            }
            for review in reviews[:RECENT_LIMIT]
        ],
        "recent_threads": [
            {
                "id": thread.id,
                "title": thread.title,
                "created_at": _iso(thread.created_at),
                "is_removed": thread.is_removed,
            }
            for thread in threads.only("id", "title", "created_at", "is_removed")[:RECENT_LIMIT]
        ],
        "badges": [
            {
                "id": grant.badge_id,
                "name": grant.badge.name,
                "slug": grant.badge.slug,
                "color": grant.badge.color,
                "icon": grant.badge.icon,
                "image": field_media_url(grant.badge.image),
                "granted_at": _iso(grant.granted_at),
                "reason": grant.reason or "",
            }
            for grant in badges
        ],
        "auth_providers": providers,
        "has_password": user.has_usable_password(),
    }


def _safe_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value)
    return f"'{text}" if text.startswith(FORMULA_PREFIXES) else text


def users_csv(queryset) -> tuple[str, int]:
    """CSV text of up to ``EXPORT_MAX_ROWS`` users of an annotated admin queryset."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    rows = 0
    for user in queryset[:EXPORT_MAX_ROWS]:
        profile = getattr(user, "userprofile", None)
        writer.writerow(
            [
                _safe_cell(value)
                for value in (
                    user.id,
                    user.username,
                    user.email,
                    user.date_joined,
                    user.last_login,
                    user.is_active,
                    user.is_staff,
                    user.is_superuser,
                    bool(profile and profile.email_verified),
                    user._list_entries_count,
                    user._reviews_count,
                    user._favorites_count,
                )
            ]
        )
        rows += 1
    return buffer.getvalue(), rows
