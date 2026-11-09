"""Benchmark the public read endpoints against the dev database.

Runs in-process through Django's test client, so it measures the view, ORM,
serializer and cache layers without network or proxy noise. For each endpoint:

- **cold**: the app cache is emptied first, so the payload is built from the DB
  (one unmeasured warm-up request first, so Postgres buffers and Python imports
  are warm; "cold" means *app-cache* cold);
- **warm**: the same request served from the cache.

It reports the median over ``--rounds`` rounds, plus the query count and the
total SQL time of the cold request.

Isolation: it uses its own Redis key prefix and only deletes keys under that
prefix, so the dev stack's cache is untouched. Request logging is disabled, so
no Celery tasks are queued. Nothing is written to the database.

    make bench-api                                  # print a Markdown table
    make bench-api ARGS="--rounds 5 --json out.json"

Numbers are only comparable across runs on the same machine and DB snapshot.
"""

import argparse
import json
import os
import statistics
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings")
os.environ.setdefault("DJANGO_ENV", "development")

import django

django.setup()

from django.conf import settings
from django.core.cache import cache, caches
from django.core.cache.backends.locmem import LocMemCache
from django.db import connection
from django.test import Client, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

WARM_REQUESTS = 5


def _bench_settings(prefix: str) -> dict:
    caches = {name: dict(config) for name, config in settings.CACHES.items()}
    caches["default"]["KEY_PREFIX"] = prefix
    rest_framework = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": dict.fromkeys(
            settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "1000000/minute"
        ),
    }
    return {
        "CACHES": caches,
        "REST_FRAMEWORK": rest_framework,
        "ALLOWED_HOSTS": [*settings.ALLOWED_HOSTS, "testserver"],
        "REQUEST_LOGGING_ENABLED": False,
    }


def _endpoints() -> dict[str, str]:
    """Build URLs from real rows, so the benchmark works on any dev snapshot."""
    from apps.animes.models import Anime, Genre
    from apps.users.models import CustomUser

    popular = (
        Anime.public_queryset()
        .filter(popularity_rank__isnull=False)
        .order_by("popularity_rank")
        .first()
    )
    if popular is None:
        raise SystemExit("The dev catalog is empty; run a catalog sync first.")
    search_term = popular.title.split()[0]
    genre = Genre.objects.filter(anime__isnull=False).order_by("name").first()
    user = CustomUser.objects.filter(is_active=True).order_by("id").first()

    anime_list = reverse("anime-list")
    endpoints = {
        "list": f"{anime_list}?page_size=24",
        "list_sorted_rating": f"{anime_list}?page_size=24&sort=rating",
        "search": f"{anime_list}?q={search_term}",
        "detail": reverse("anime-detail", kwargs={"slug": popular.slug}),
        "trending": reverse("anime-trending"),
        "top_rated": reverse("anime-top-rated"),
        "browse_rows": reverse("anime-browse-rows"),
        "schedule": reverse("anime-schedule"),
    }
    if genre is not None:
        endpoints["list_genre"] = f"{anime_list}?page_size=24&genre={genre.slug}"
    if user is not None:
        endpoints["public_profile"] = reverse(
            "public_user_profile", kwargs={"username": user.username}
        )
    return endpoints


def _timed_get(client: Client, url: str) -> tuple[float, int, float, int]:
    """Return (wall ms, query count, SQL ms, response bytes)."""
    with CaptureQueriesContext(connection) as queries:
        started = time.perf_counter()
        response = client.get(url)
        elapsed_ms = (time.perf_counter() - started) * 1000
    if response.status_code != 200:
        raise SystemExit(f"GET {url} returned {response.status_code}: {response.content[:300]!r}")
    sql_ms = sum(float(query["time"]) for query in queries.captured_queries) * 1000
    return elapsed_ms, len(queries), sql_ms, len(response.content)


def _clear_bench_cache() -> None:
    """Empty only this run's cache entries."""
    backend = caches["default"]
    if hasattr(backend, "delete_pattern"):  # django-redis: honours KEY_PREFIX
        backend.delete_pattern("*")
    elif isinstance(backend, LocMemCache):  # process-local, safe to clear
        backend.clear()
    else:
        raise SystemExit(f"Unsupported cache backend {type(backend).__name__}.")


def run(rounds: int) -> dict:
    endpoints = _endpoints()
    client = Client()
    results = {}

    for name, url in endpoints.items():
        client.get(url)  # warm-up, not measured
        cold, warm, query_counts, sql_times = [], [], [], []
        size = 0
        for _ in range(rounds):
            _clear_bench_cache()
            elapsed_ms, query_count, sql_ms, size = _timed_get(client, url)
            cold.append(elapsed_ms)
            query_counts.append(query_count)
            sql_times.append(sql_ms)
            warm.extend(_timed_get(client, url)[0] for _ in range(WARM_REQUESTS))

        results[name] = {
            "url": url,
            "cold_ms": round(statistics.median(cold), 1),
            "warm_ms": round(statistics.median(warm), 1),
            "cold_queries": max(query_counts),
            "cold_sql_ms": round(statistics.median(sql_times), 1),
            "response_kb": round(size / 1024, 1),
        }
        print(f"  {name}: done", file=sys.stderr)

    _clear_bench_cache()
    return results


def _markdown(results: dict, rounds: int) -> str:
    from apps.animes.models import Anime

    lines = [
        f"Catalog: {Anime.objects.count():,} anime · rounds: {rounds} · "
        f"warm samples per round: {WARM_REQUESTS} · DEBUG={settings.DEBUG}",
        "",
        "| Endpoint | Cold p50 (ms) | Warm p50 (ms) | Cold queries | Cold SQL (ms) | Size (KB) |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, row in results.items():
        lines.append(
            f"| `{name}` | {row['cold_ms']} | {row['warm_ms']} | {row['cold_queries']} | "
            f"{row['cold_sql_ms']} | {row['response_kb']} |"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--json", type=Path, help="also write raw results to this file")
    args = parser.parse_args()

    prefix = f"bench-{uuid.uuid4().hex[:8]}"
    with override_settings(**_bench_settings(prefix)):
        if cache.key_prefix != prefix:
            raise SystemExit("Cache isolation failed; refusing to clear keys.")
        results = run(args.rounds)
        print(_markdown(results, args.rounds))

    if args.json:
        args.json.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
