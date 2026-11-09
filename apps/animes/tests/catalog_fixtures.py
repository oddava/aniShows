"""Deterministic catalog data for the public-API guard tests.

Shared by ``test_query_budgets.py`` and ``test_public_contract.py``. Every row
gets the related data the public endpoints serialize (genres, studios, cast,
staff, theme songs, relations, list entries, reviews), so an N+1 query on any of
them shows up as a growing query count.
"""

from datetime import UTC, date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse

from apps.animes.models import (
    Anime,
    AnimeCharacter,
    AnimeRelation,
    AnimeStaff,
    AnimeStudio,
    Character,
    Genre,
    Review,
    Staff,
    Studio,
    ThemeSong,
    UserFavorite,
)
from apps.users.models import UserAnimeList

SEARCH_TERM = "Guard"
PROFILE_USERNAME = "guard_viewer"
# Fixed so serialized payloads (and their date fields) don't depend on today.
BASE_DATE = date(2025, 1, 6)  # a Monday
NEXT_AIRING_AT = datetime(2030, 1, 7, 3, 0, tzinfo=UTC)  # a Monday in Tokyo
DETAIL_SLUG = "guard-anime-002"

# name -> (url builder, request as the fixture viewer?)
PUBLIC_ENDPOINTS = {
    "list": (lambda: f"{reverse('anime-list')}?page_size=24", False),
    "list_authenticated": (lambda: f"{reverse('anime-list')}?page_size=24", True),
    "search": (lambda: f"{reverse('anime-list')}?q={SEARCH_TERM}", False),
    "trending": (lambda: reverse("anime-trending"), False),
    "top_rated": (lambda: reverse("anime-top-rated"), False),
    "browse_rows": (lambda: reverse("anime-browse-rows"), False),
    "schedule": (lambda: reverse("anime-schedule"), False),
    "detail": (lambda: reverse("anime-detail", kwargs={"slug": DETAIL_SLUG}), False),
    "detail_authenticated": (
        lambda: reverse("anime-detail", kwargs={"slug": DETAIL_SLUG}),
        True,
    ),
    "anime_reviews": (lambda: reverse("anime-reviews", kwargs={"slug": DETAIL_SLUG}), False),
    "public_profile": (
        lambda: reverse("public_user_profile", kwargs={"username": PROFILE_USERNAME}),
        False,
    ),
}


def _shared_taxonomy():
    genres = [
        Genre.objects.get_or_create(slug="action", defaults={"name": "Action"})[0],
        Genre.objects.get_or_create(slug="drama", defaults={"name": "Drama"})[0],
    ]
    studio = Studio.objects.get_or_create(name="Guard Studio")[0]
    return genres, studio


def build_catalog(count: int, *, start: int = 1) -> list[Anime]:
    """Create ``count`` fully related anime, numbered from ``start``."""
    genres, studio = _shared_taxonomy()
    created: list[Anime] = []
    previous = Anime.objects.order_by("-id").first()

    for index in range(start, start + count):
        anime = Anime.objects.create(
            title=f"{SEARCH_TERM} Anime {index:03d}",
            title_jp=f"ガード {index:03d}",
            slug=f"guard-anime-{index:03d}",
            synopsis=f"Guard test anime number {index}.",
            anime_type=Anime.AnimeType.tv,
            status=Anime.AnimeStatus.airing,
            episode_count=12,
            member_count=300_000 + index,
            rating=8.0 + index / 100,
            popularity_rank=index,
            trending_rank=index,
            site_rank=index,
            season="winter",
            season_year=2025,
            release_date=BASE_DATE - timedelta(days=index),
            broadcast_day="Monday",
            next_airing_date=NEXT_AIRING_AT + timedelta(minutes=index),
            next_airing_episode=3,
            tags=["Shounen"],
        )
        anime.genres.set(genres)
        AnimeStudio.objects.create(anime=anime, studio=studio)

        for role_index in range(2):
            voice_actor = Staff.objects.create(name=f"Voice {index}-{role_index}")
            character = Character.objects.create(name=f"Character {index}-{role_index}")
            AnimeCharacter.objects.create(
                anime=anime,
                character=character,
                role=AnimeCharacter.Role.MAIN,
                voice_actor=voice_actor,
            )
            crew = Staff.objects.create(name=f"Crew {index}-{role_index}")
            AnimeStaff.objects.create(anime=anime, staff=crew, role="Director")
            ThemeSong.objects.create(
                anime=anime,
                song_type=ThemeSong.SongType.OPENING
                if role_index == 0
                else ThemeSong.SongType.ENDING,
                track_number=1,
                title=f"Song {index}-{role_index}",
                artist="Guard Band",
            )

        if previous is not None:
            AnimeRelation.objects.create(
                from_anime=anime,
                to_anime=previous,
                relation_type="PREQUEL",
                title=previous.title,
            )
        previous = anime
        created.append(anime)

    return created


def build_viewer(anime_list: list[Anime]):
    """A user whose list, favorites and reviews cover every given anime."""
    user_model = get_user_model()
    user, _ = user_model.objects.get_or_create(
        username=PROFILE_USERNAME,
        defaults={"email": f"{PROFILE_USERNAME}@example.com"},
    )
    for order, anime in enumerate(anime_list):
        UserAnimeList.objects.get_or_create(
            user=user,
            anime=anime,
            defaults={
                "status": UserAnimeList.UserAnimeStatus.watching,
                "episodes_watched": 2,
                "score": 8,
            },
        )
        UserFavorite.objects.get_or_create(user=user, anime=anime, defaults={"order": order})
        Review.objects.get_or_create(
            user=user,
            anime=anime,
            defaults={"rating": 8, "text": f"Review of {anime.title}. " * 5},
        )
    return user
