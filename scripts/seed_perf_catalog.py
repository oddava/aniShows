"""Seed a large synthetic catalog for read-path performance work.

Fills the *test* Postgres of this checkout (``docker compose --profile test``)
with ``--count`` anime that look like the real catalog: genres and studios,
release years 1980-2027 with seasons, ~1.5% airing (with broadcast slots) and
~5% upcoming, scores on ~75% of rows, a long-tailed member count with the
popularity and site ranks derived from it, ~4% adult rows (hentai/erotica genre
or an explicit tag) and an ``offline_db_payload`` on ~90% of rows. Generation is
deterministic for a given ``--seed``.

    docker compose --profile test up -d test_db
    docker compose --profile test run --rm test python manage.py migrate
    docker compose --profile test run --rm test python scripts/seed_perf_catalog.py

It refuses to run against anything but the throwaway ``test_db`` service, and
``--reset`` deletes the existing catalog first.
"""

import argparse
import os
import random
import sys
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings.test")

import django

django.setup()

from django.conf import settings
from django.db import connection, transaction

BATCH = 2_000
# Fixed so the schedule and season shelves look the same on every run.
TODAY = date(2026, 11, 10)

GENRES = [
    ("Action", 0.32),
    ("Adventure", 0.18),
    ("Comedy", 0.38),
    ("Drama", 0.22),
    ("Fantasy", 0.20),
    ("Horror", 0.04),
    ("Mahou Shoujo", 0.03),
    ("Mecha", 0.07),
    ("Music", 0.05),
    ("Mystery", 0.06),
    ("Psychological", 0.04),
    ("Romance", 0.14),
    ("Sci-Fi", 0.16),
    ("Slice of Life", 0.12),
    ("Sports", 0.05),
    ("Supernatural", 0.10),
    ("Thriller", 0.03),
    ("Ecchi", 0.05),
]
ADULT_GENRES = ["Hentai", "Erotica"]
TAGS = [
    "male protagonist",
    "female protagonist",
    "school",
    "shounen",
    "seinen",
    "shoujo",
    "josei",
    "isekai",
    "magic",
    "super power",
    "military",
    "historical",
    "iyashikei",
    "time skip",
    "ensemble cast",
    "tragedy",
    "revenge",
    "coming of age",
    "cgi",
    "episodic",
    "primarily teen cast",
    "primarily adult cast",
    "swordplay",
    "gore",
    "dragons",
    "demons",
    "robots",
    "space",
    "idol",
    "cute girls doing cute things",
    "food",
    "travel",
    "work",
    "family life",
    "found family",
    "anti-hero",
    "politics",
    "war",
    "survival",
    "post-apocalyptic",
    "cyberpunk",
    "detective",
    "vampire",
    "zombie",
    "martial arts",
    "baseball",
    "basketball",
    "music band",
    "parody",
    "satire",
    "surreal comedy",
    "love triangle",
    "kuudere",
    "tsundere",
    "harem",
]
EXPLICIT_TAGS = ["nsfw", "explicit sex", "incest", "netorare", "futanari", "masturbation"]
SYLLABLES = [
    "ka",
    "ki",
    "ku",
    "ke",
    "ko",
    "sa",
    "shi",
    "su",
    "se",
    "so",
    "ta",
    "chi",
    "tsu",
    "te",
    "to",
    "na",
    "ni",
    "nu",
    "ne",
    "no",
    "ha",
    "hi",
    "fu",
    "he",
    "ho",
    "ma",
    "mi",
    "mu",
    "me",
    "mo",
    "ya",
    "yu",
    "yo",
    "ra",
    "ri",
    "ru",
    "re",
    "ro",
    "wa",
    "ga",
    "gi",
    "go",
    "za",
    "ji",
    "zu",
    "da",
    "de",
    "do",
    "ba",
    "bi",
    "bu",
    "be",
]
ENGLISH_WORDS = [
    "Love",
    "Sword",
    "Sky",
    "World",
    "Hero",
    "Demon",
    "King",
    "Girl",
    "Boy",
    "Magic",
    "Academy",
    "Story",
    "Night",
    "Star",
    "Dragon",
    "Blade",
    "Moon",
    "Summer",
    "Spring",
    "Dream",
    "Battle",
    "Princess",
    "Ghost",
    "Online",
    "Chronicle",
    "Legend",
    "Days",
    "Heart",
    "Blue",
    "Red",
    "Black",
    "White",
    "Last",
    "First",
    "Little",
    "Tokyo",
]
SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"]
SEASON_START_MONTH = {"WINTER": 1, "SPRING": 4, "SUMMER": 7, "FALL": 10}
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
TYPES = [("TV", 0.38), ("Movie", 0.16), ("OVA", 0.16), ("ONA", 0.14), ("Special", 0.16)]
SOURCES = [
    "Original",
    "Manga",
    "Light Novel",
    "Visual Novel",
    "Game",
    "Web Manga",
    "Novel",
    "Music",
    "Other",
    "",
]


def _require_test_database() -> None:
    db = settings.DATABASES["default"]
    if db["HOST"] != "test_db" or settings.SETTINGS_MODULE != "root.settings.test":
        raise SystemExit(
            "Refusing to seed: only the throwaway test_db service may be seeded "
            f"(HOST={db['HOST']!r}, settings={settings.SETTINGS_MODULE!r})."
        )


def _word(rng: random.Random) -> str:
    return "".join(rng.choice(SYLLABLES) for _ in range(rng.randint(2, 4))).capitalize()


def _title(rng: random.Random) -> str:
    parts = []
    for _ in range(rng.choice([1, 2, 2, 3, 3, 4])):
        parts.append(rng.choice(ENGLISH_WORDS) if rng.random() < 0.35 else _word(rng))
    title = " ".join(parts)
    if rng.random() < 0.15:
        title += f" Season {rng.randint(2, 5)}"
    return title


def _sentence(rng: random.Random) -> str:
    words = [_word(rng).lower() for _ in range(rng.randint(8, 18))]
    return " ".join(words).capitalize() + "."


def _year(rng: random.Random) -> int:
    # Skewed towards recent years, like the real catalog.
    return min(2027, int(2027 - abs(rng.gauss(0, 13))))


def _offline_payload(rng: random.Random, title: str, mal_id: int, anilist_id: int, tags):
    synonyms = [_title(rng) for _ in range(rng.choice([0, 1, 2, 4, 8, 15]))]
    sources = [
        f"https://myanimelist.net/anime/{mal_id}",
        f"https://anilist.co/anime/{anilist_id}",
        f"https://kitsu.app/anime/{rng.randint(1, 50_000)}",
        f"https://anidb.net/anime/{rng.randint(1, 20_000)}",
        f"https://www.anime-planet.com/anime/{title.lower().replace(' ', '-')}",
        f"https://anisearch.com/anime/{rng.randint(1, 20_000)}",
        f"https://notify.moe/anime/{rng.getrandbits(40):x}",
    ][: rng.randint(3, 7)]
    related = [
        f"https://myanimelist.net/anime/{rng.randint(1, 60_000)}"
        for _ in range(rng.choice([0, 0, 1, 2, 3, 6, 12]))
    ]
    return {
        "sources": sources,
        "title": title,
        "type": rng.choice(["TV", "MOVIE", "OVA", "ONA", "SPECIAL"]),
        "episodes": rng.randint(1, 26),
        "status": rng.choice(["FINISHED", "ONGOING", "UPCOMING"]),
        "animeSeason": {"season": rng.choice(SEASONS), "year": _year(rng)},
        "picture": f"https://cdn.myanimelist.net/images/anime/{rng.randint(1, 9999)}/{mal_id}.jpg",
        "thumbnail": f"https://cdn.myanimelist.net/images/anime/{rng.randint(1, 9999)}/{mal_id}t.jpg",
        "duration": {"value": rng.choice([300, 1440, 1500, 5400]), "unit": "SECONDS"},
        "score": {"arithmeticGeometricMean": round(rng.uniform(4, 9), 3)},
        "synonyms": synonyms,
        "studios": [_word(rng) for _ in range(rng.randint(0, 2))],
        "producers": [_word(rng) for _ in range(rng.randint(0, 5))],
        "relatedAnime": related,
        "tags": list(tags) + [rng.choice(TAGS) for _ in range(rng.randint(0, 10))],
    }


def _build_rows(rng: random.Random, count: int):
    from apps.animes.models import Anime

    # Long tail: ~0.6% of rows above 200k members, ~2% above 25k, capped like MAL.
    member_counts = [min(4_000_000, int(rng.paretovariate(0.6) * 40)) for _ in range(count)]
    rows, extras = [], []
    for index in range(count):
        status_roll = rng.random()
        if status_roll < 0.015:
            status = Anime.AnimeStatus.airing
            year = rng.choice([2025, 2026, 2026, 2026])
        elif status_roll < 0.065:
            status = Anime.AnimeStatus.upcoming
            year = rng.choice([2026, 2027, 2027])
        else:
            status = Anime.AnimeStatus.finished
            year = min(_year(rng), 2026)
        season = rng.choice(SEASONS)
        start_month = SEASON_START_MONTH[season]
        release_date = None
        if status != Anime.AnimeStatus.upcoming or rng.random() < 0.3:
            release_date = date(year, start_month, 1) + timedelta(days=rng.randint(0, 89))
        has_season = rng.random() < 0.8
        anime_type = rng.choices([t for t, _ in TYPES], [w for _, w in TYPES])[0]
        member_count = member_counts[index] if status != Anime.AnimeStatus.upcoming else 0
        title = _title(rng)
        mal_id = 100_000 + index
        anilist_id = 200_000 + index if rng.random() < 0.9 else None

        genre_names = [name for name, weight in GENRES if rng.random() < weight]
        adult_roll = rng.random()
        tags = rng.sample(TAGS, rng.randint(0, 12))
        if adult_roll < 0.025:
            genre_names.append("Hentai")
        elif adult_roll < 0.03:
            genre_names.append("Erotica")
        elif adult_roll < 0.04:
            tags.append(rng.choice(EXPLICIT_TAGS))
        if not genre_names:
            genre_names = [rng.choice(GENRES)[0]]

        airing = status == Anime.AnimeStatus.airing
        next_airing = None
        if airing and rng.random() < 0.85:
            next_airing = datetime.combine(TODAY, time(15), tzinfo=UTC) + timedelta(
                hours=rng.randint(0, 24 * 7)
            )
        rows.append(
            Anime(
                title=title,
                title_jp=f"{_word(rng)}{_word(rng)}" if rng.random() < 0.85 else "",
                slug=f"perf-{index:06d}",
                synopsis=" ".join(_sentence(rng) for _ in range(rng.randint(2, 8))),
                anime_type=anime_type,
                status=status,
                episode_count=rng.randint(1, 26) if anime_type == "TV" else rng.randint(1, 4),
                duration_minutes=rng.choice([5, 12, 24, 24, 24, 90, 110]),
                member_count=member_count,
                release_date=release_date,
                end_date=release_date + timedelta(days=90) if release_date else None,
                cover_image_external_url=f"https://img.anili.st/media/{mal_id}/cover.jpg",
                banner_image_external_url=(
                    f"https://img.anili.st/media/{mal_id}/banner.jpg" if rng.random() < 0.4 else ""
                ),
                rating=(
                    Decimal(str(round(min(9.4, max(2.0, rng.gauss(6.6, 1.0))), 1)))
                    if rng.random() < 0.75 and status != Anime.AnimeStatus.upcoming
                    else None
                ),
                tags=tags,
                offline_db_payload=(
                    _offline_payload(rng, title, mal_id, anilist_id or 0, tags)
                    if rng.random() < 0.9
                    else {}
                ),
                synonyms=[_title(rng) for _ in range(rng.choice([0, 1, 2, 4]))],
                source_urls=[f"https://myanimelist.net/anime/{mal_id}"],
                provider_ids={"mal": mal_id, "anilist": anilist_id},
                broadcast_day=rng.choice(DAYS) if airing and rng.random() < 0.9 else "",
                broadcast_time=time(rng.randint(0, 23), rng.choice([0, 30])) if airing else None,
                broadcast_timezone="Asia/Tokyo" if airing else "",
                next_airing_date=next_airing,
                next_airing_episode=rng.randint(2, 24) if next_airing else None,
                source_material=rng.choice(SOURCES),
                season=season if has_season else "",
                season_year=year if has_season else None,
                mal_id=mal_id,
                anilist_id=anilist_id,
            )
        )
        extras.append(
            {
                "genres": genre_names,
                "studios": rng.sample(range(320), rng.choice([0, 1, 1, 1, 2, 3])),
            }
        )

    _assign_ranks(rng, rows)
    return rows, extras


def _assign_ranks(rng: random.Random, rows) -> None:
    by_members = sorted(
        (row for row in rows if row.member_count > 0), key=lambda row: -row.member_count
    )
    for rank, row in enumerate(by_members, start=1):
        row.popularity_rank = rank
    rated = sorted(
        (row for row in rows if row.rating is not None and row.member_count > 500),
        key=lambda row: (-row.rating, -row.member_count),
    )
    for rank, row in enumerate(rated, start=1):
        row.site_rank = rank
    # Trending: a few hundred recent, reasonably popular shows.
    candidates = [row for row in rows if row.season_year and row.season_year >= 2025]
    candidates.sort(key=lambda row: -(row.member_count * rng.uniform(0.5, 1.5)))
    for rank, row in enumerate(candidates[:300], start=1):
        row.trending_rank = rank


@transaction.atomic
def seed(count: int, seed_value: int, reset: bool) -> None:
    from django.contrib.auth import get_user_model
    from django.utils.text import slugify

    from apps.animes.models import Anime, AnimeStudio, Genre, OfflineAnimeSyncState, Studio
    from apps.users.models import UserAnimeList

    if reset:
        Anime.objects.all().delete()
    elif Anime.objects.exists():
        raise SystemExit("The catalog is not empty; pass --reset to replace it.")

    rng = random.Random(seed_value)
    genres = {
        name: Genre.objects.get_or_create(slug=slugify(name), defaults={"name": name})[0]
        for name in [name for name, _ in GENRES] + ADULT_GENRES
    }
    studios = [
        Studio.objects.get_or_create(name=f"Perf Studio {index:03d}")[0] for index in range(320)
    ]

    rows, extras = _build_rows(rng, count)
    created = []
    for start in range(0, len(rows), BATCH):
        created.extend(Anime.objects.bulk_create(rows[start : start + BATCH]))

    genre_links, studio_links, sync_states = [], [], []
    through = Anime.genres.through
    for anime, extra in zip(created, extras, strict=True):
        genre_links.extend(
            through(anime_id=anime.id, genre_id=genres[name].id) for name in set(extra["genres"])
        )
        studio_links.extend(
            AnimeStudio(anime_id=anime.id, studio_id=studios[studio].id, position=position)
            for position, studio in enumerate(extra["studios"])
        )
        if rng.random() < 0.8:
            sync_states.append(
                OfflineAnimeSyncState(anime_id=anime.id, quarantined=rng.random() < 0.005)
            )
    through.objects.bulk_create(genre_links, batch_size=BATCH * 5)
    AnimeStudio.objects.bulk_create(studio_links, batch_size=BATCH * 5)
    OfflineAnimeSyncState.objects.bulk_create(sync_states, batch_size=BATCH * 5)

    # bulk_create skips Anime.save() and the genre signal, so derive the
    # denormalized adult flag (D5) in one pass when the schema has it.
    if any(field.name == "is_adult" for field in Anime._meta.concrete_fields):
        from apps.animes.adult_content import adult_content_q

        Anime.objects.filter(adult_content_q()).update(is_adult=True)

    # One public profile for the benchmark's profile endpoint.
    user, _ = get_user_model().objects.get_or_create(
        username="perf_viewer", defaults={"email": "perf_viewer@example.com"}
    )
    UserAnimeList.objects.bulk_create(
        [
            UserAnimeList(user=user, anime=anime, status=UserAnimeList.UserAnimeStatus.completed)
            for anime in rng.sample(created, 40)
        ],
        ignore_conflicts=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--count", type=int, default=40_000)
    parser.add_argument("--seed", type=int, default=20261110)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    _require_test_database()
    seed(args.count, args.seed, args.reset)
    with connection.cursor() as cursor:
        cursor.execute("VACUUM ANALYZE")
    from apps.animes.models import Anime

    print(f"Seeded {Anime.objects.count():,} anime (seed {args.seed}).")


if __name__ == "__main__":
    main()
