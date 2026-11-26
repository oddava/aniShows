"""Admin global search: a few users, anime, reviews and threads for the command palette."""

from __future__ import annotations

from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Case, IntegerField, Prefetch, Q, Value, When
from rest_framework.response import Response
from rest_framework.views import APIView

from ...animes.models import Anime, Review
from ...forums.models import Thread
from ...users.services.avatar_service import get_user_avatar_url
from ..permissions import AdminPolicyMixin
from ..services.media import poster_url

User = get_user_model()

QUERY_MIN_LENGTH = 2
QUERY_MAX_LENGTH = 100
RESULT_LIMIT = 5
SNIPPET_LENGTH = 120


def _rank(field: str, query: str):
    """0 for an exact match, 1 for a prefix match, 2 for anything else."""
    return Case(
        When(**{f"{field}__iexact": query}, then=Value(0)),
        When(**{f"{field}__istartswith": query}, then=Value(1)),
        default=Value(2),
        output_field=IntegerField(),
    )


def _id_match(query: str, *fields: str) -> Q:
    if not query.isdigit() or len(query) > 10:
        return Q(pk__in=[])
    number = int(query)
    match = Q()
    for field in fields:
        match |= Q(**{field: number})
    return match


def search_users(query: str) -> list[dict]:
    google = SocialAccount.objects.filter(provider="google").only("user_id", "extra_data")
    users = (
        User.objects.filter(
            Q(username__icontains=query) | Q(email__icontains=query) | _id_match(query, "pk")
        )
        .select_related("userprofile")
        .prefetch_related(
            Prefetch("socialaccount_set", queryset=google, to_attr="_prefetched_social_accounts")
        )
        .annotate(_rank=_rank("username", query))
        .order_by("_rank", "username")[:RESULT_LIMIT]
    )
    return [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "is_staff": user.is_staff or user.is_superuser,
            "avatar": get_user_avatar_url(user) or None,
        }
        for user in users
    ]


def search_anime(query: str) -> list[dict]:
    rows = (
        Anime.objects.filter(
            Q(title__icontains=query)
            | Q(title_jp__icontains=query)
            | _id_match(query, "pk", "anilist_id", "mal_id")
        )
        .annotate(_rank=_rank("title", query))
        .order_by("_rank", "popularity_rank", "title")
        .values(
            "id",
            "title",
            "slug",
            "status",
            "anime_type",
            "cover_image",
            "cover_image_external_url",
        )[:RESULT_LIMIT]
    )
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "slug": row["slug"],
            "poster": poster_url(row["cover_image"], row["cover_image_external_url"]),
            "status": row["status"],
            "anime_type": row["anime_type"],
        }
        for row in rows
    ]


def search_reviews(query: str) -> list[dict]:
    rows = (
        # Not the review text: scanning every body per keystroke does not scale.
        # Full-text review search lives on the paginated Reviews page.
        Review.objects.filter(
            Q(user__username__iexact=query)
            | Q(anime__title__icontains=query)
            | _id_match(query, "pk")
        )
        .order_by("-created_at")
        .values("id", "text", "anime__title", "user__username")[:RESULT_LIMIT]
    )
    return [
        {
            "id": row["id"],
            "snippet": (row["text"] or "")[:SNIPPET_LENGTH],
            "anime_title": row["anime__title"],
            "username": row["user__username"],
        }
        for row in rows
    ]


def search_threads(query: str) -> list[dict]:
    rows = (
        Thread.objects.filter(Q(title__icontains=query) | _id_match(query, "pk"))
        .order_by("-created_at")
        .values("id", "title", "category__name", "author__username")[:RESULT_LIMIT]
    )
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "category": row["category__name"],
            "author": row["author__username"],
        }
        for row in rows
    ]


class AdminSearchView(AdminPolicyMixin, APIView):
    """``?q=`` (2-100 characters): at most five of each kind; digits also match ids."""

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if not QUERY_MIN_LENGTH <= len(query) <= QUERY_MAX_LENGTH:
            return Response(
                {"detail": f"q must be {QUERY_MIN_LENGTH}-{QUERY_MAX_LENGTH} characters."},
                status=400,
            )
        return Response(
            {
                "users": search_users(query),
                "anime": search_anime(query),
                "reviews": search_reviews(query),
                "threads": search_threads(query),
            }
        )
