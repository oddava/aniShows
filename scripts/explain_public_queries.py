"""EXPLAIN the SQL that the public read endpoints run, plus table and index stats.

Requests each endpoint in-process as an anonymous visitor on a cold app cache,
captures the SQL it runs (``CaptureQueriesContext``) and runs
``EXPLAIN (ANALYZE, BUFFERS)`` on every catalog query. With ``--adult-variant``
it also captures the same requests as a viewer allowed to see adult content, so
the cost of the adult-content exclusion can be read off directly.

    docker compose --profile test run --rm test python scripts/explain_public_queries.py explain
    docker compose --profile test run --rm test python scripts/explain_public_queries.py table-stats
    docker compose --profile test run --rm test python scripts/explain_public_queries.py index-usage
    docker compose --profile test run --rm test python scripts/explain_public_queries.py reset-stats

Meant for the seeded test database (``scripts/seed_perf_catalog.py``). Nothing is
written to the catalog (``reset-stats`` only resets Postgres statistics).
"""

import argparse
import contextlib
import os
import re
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings.test")

import django

django.setup()

from django.core.cache import cache
from django.db import connection
from django.test import Client, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

# Tables whose queries are worth explaining (skip session/settings lookups).
CATALOG_TABLE = re.compile(r'FROM "anime_anime"|JOIN "anime_anime"')


def _endpoints() -> dict[str, str]:
    from apps.animes.models import Anime, Genre

    popular = (
        Anime.public_queryset()
        .filter(popularity_rank__isnull=False)
        .order_by("popularity_rank")
        .first()
    )
    search_term = popular.title.split()[0]
    genre = Genre.objects.filter(anime__isnull=False).order_by("name").first()
    anime_list = reverse("anime-list")
    return {
        "list": f"{anime_list}?page_size=24",
        "search": f"{anime_list}?q={search_term}",
        "list_genre": f"{anime_list}?page_size=24&genre={genre.slug}",
        "browse_rows": reverse("anime-browse-rows"),
        "schedule": reverse("anime-schedule"),
    }


def _capture(url: str) -> list[str]:
    cache.clear()
    with CaptureQueriesContext(connection) as queries:
        response = Client().get(url)
    if response.status_code != 200:
        raise SystemExit(f"GET {url} returned {response.status_code}")
    return [
        query["sql"] for query in queries.captured_queries if CATALOG_TABLE.search(query["sql"])
    ]


def _explain(sql: str) -> tuple[str, float]:
    with connection.cursor() as cursor:
        cursor.execute(f"EXPLAIN (ANALYZE, BUFFERS) {sql}")
        plan = "\n".join(row[0] for row in cursor.fetchall())
    match = re.search(r"Execution Time: ([\d.]+) ms", plan)
    return plan, float(match.group(1)) if match else 0.0


def _best_of(sql: str, runs: int) -> tuple[str, float]:
    plans = [_explain(sql) for _ in range(runs)]
    return min(plans, key=lambda item: item[1])


def explain(args) -> None:
    from apps.animes.services.public_anime_service import AnimeQueryService

    out = []
    allowed = {"ALLOWED_HOSTS": ["*"], "REQUEST_LOGGING_ENABLED": False}
    with override_settings(**allowed):
        endpoints = _endpoints()
        variants = {"anonymous (adult content excluded)": None}
        if args.adult_variant:
            variants["adult content allowed (no exclusion)"] = True
        summary = []
        for name, url in endpoints.items():
            out.append(f"## `{name}` — `{url}`\n")
            for label, can_view in variants.items():
                patcher = (
                    mock.patch.object(
                        AnimeQueryService, "can_view_adult_content", return_value=can_view
                    )
                    if can_view
                    else contextlib.nullcontext()
                )
                with patcher:
                    statements = _capture(url)
                total = 0.0
                out.append(f"### {label}: {len(statements)} catalog queries\n")
                for index, sql in enumerate(statements, start=1):
                    plan, ms = _best_of(sql, args.runs)
                    total += ms
                    out.append(f"#### Query {index} — {ms:.2f} ms (best of {args.runs})\n")
                    out.append("```sql\n" + sql + "\n```\n")
                    out.append("```\n" + plan + "\n```\n")
                summary.append((name, label, len(statements), total))
        out.insert(0, "| Endpoint | Variant | Catalog queries | Sum of execution times (ms) |")
        out.insert(1, "|---|---|---:|---:|")
        for offset, (name, label, count, total) in enumerate(summary, start=2):
            out.insert(offset, f"| `{name}` | {label} | {count} | {total:.2f} |")
        out.insert(len(summary) + 2, "")
    text = "\n".join(out)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    print(text if not args.output else "\n".join(out[: len(summary) + 2]))


def _rows(sql: str) -> tuple[list[str], list[tuple]]:
    with connection.cursor() as cursor:
        cursor.execute(sql)
        return [col.name for col in cursor.description], cursor.fetchall()


def _print_table(columns, rows) -> None:
    print("| " + " | ".join(columns) + " |")
    print("|" + "---|" * len(columns))
    for row in rows:
        print("| " + " | ".join(str(value) for value in row) + " |")
    print()


def table_stats(_args) -> None:
    _print_table(
        *_rows(
            """
            SELECT count(*) AS rows,
                   pg_size_pretty(pg_table_size('anime_anime')) AS table_incl_toast,
                   pg_size_pretty(pg_relation_size('anime_anime')) AS heap,
                   pg_size_pretty(pg_total_relation_size(reltoastrelid)) AS toast,
                   pg_size_pretty(pg_indexes_size('anime_anime')) AS indexes
            FROM anime_anime, pg_class WHERE pg_class.relname = 'anime_anime'
            GROUP BY reltoastrelid
            """
        )
    )
    _print_table(
        *_rows(
            """
            SELECT 'offline_db_payload' AS col,
                   pg_size_pretty(sum(pg_column_size(offline_db_payload))) AS stored,
                   round(avg(pg_column_size(offline_db_payload))) AS avg_bytes,
                   count(*) FILTER (WHERE pg_column_size(offline_db_payload) > 2000)
                     AS rows_over_2kb
            FROM anime_anime
            UNION ALL
            SELECT 'synopsis', pg_size_pretty(sum(pg_column_size(synopsis))),
                   round(avg(pg_column_size(synopsis))), NULL FROM anime_anime
            UNION ALL
            SELECT 'tags', pg_size_pretty(sum(pg_column_size(tags))),
                   round(avg(pg_column_size(tags))), NULL FROM anime_anime
            UNION ALL
            SELECT 'whole row', pg_size_pretty(sum(pg_column_size(a.*))),
                   round(avg(pg_column_size(a.*))), NULL FROM anime_anime a
            """
        )
    )


def index_usage(_args) -> None:
    _print_table(
        *_rows(
            """
            SELECT s.indexrelname AS index, s.idx_scan AS scans, s.idx_tup_read AS tuples_read,
                   pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
                   pg_get_indexdef(s.indexrelid) AS definition
            FROM pg_stat_user_indexes s
            WHERE s.relname = 'anime_anime'
            ORDER BY s.idx_scan, s.indexrelname
            """
        )
    )


def reset_stats(_args) -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_stat_reset()")
    print("pg_stat counters reset.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    explain_parser = sub.add_parser("explain")
    explain_parser.add_argument("--runs", type=int, default=3)
    explain_parser.add_argument("--adult-variant", action="store_true")
    explain_parser.add_argument("--output", help="write the full plans to this Markdown file")
    sub.add_parser("table-stats")
    sub.add_parser("index-usage")
    sub.add_parser("reset-stats")
    args = parser.parse_args()
    {
        "explain": explain,
        "table-stats": table_stats,
        "index-usage": index_usage,
        "reset-stats": reset_stats,
    }[args.command](args)


if __name__ == "__main__":
    main()
