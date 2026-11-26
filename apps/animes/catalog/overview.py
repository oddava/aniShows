"""The catalog's state in one payload: the admin Catalog page and ``manage.py catalog status``."""

from __future__ import annotations

from typing import Any

from django.db.models import Count, Q

from ..models import Anime, CatalogRun
from . import scope
from .lanes import load_cursor, season_window, seed_progress, utc_from_timestamp
from .runner import is_running

LANE_INFO = (
    ("seasons", "Seasons", "Every 6 hours", "Last, this, next and the following season, in full."),
    ("delta", "Changes", "Every 15 minutes", "Every title AniList edited since the last run."),
    ("trending", "Trending", "Hourly", "AniList's trending top 50 and the trending ranks."),
    ("airing", "Airing", "Hourly", "Next-episode times for the shows on air."),
    (
        "hydrate",
        "Details",
        "Every 10 minutes",
        "Cast, staff and images, for what people open first.",
    ),
    ("seed", "Full sweep", "Weekly, continues hourly", "Every title in scope, one year at a time."),
)


def serialize_run(run: CatalogRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "id": run.id,
        "lane": run.lane,
        "lane_label": run.get_lane_display(),
        "trigger": run.trigger,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "duration_seconds": (
            round((run.finished_at - run.started_at).total_seconds(), 1)
            if run.finished_at
            else None
        ),
        "requests": run.requests,
        "fetched": run.fetched,
        "created": run.created,
        "updated": run.updated,
        "excluded": run.excluded,
        "detail": run.detail,
        "error": run.error,
    }


def _season_rows() -> list[dict[str, Any]]:
    last_seasons = (
        CatalogRun.objects.filter(
            lane=CatalogRun.Lane.SEASONS,
            status__in=[CatalogRun.Status.SUCCEEDED, CatalogRun.Status.PARTIAL],
        )
        .order_by("-started_at")
        .first()
    )
    counted = {
        (item.get("season"), item.get("year")): item.get("anilist")
        for item in ((last_seasons.detail or {}).get("seasons") or [] if last_seasons else [])
    }
    rows = []
    for index, (season, year) in enumerate(season_window()):
        listed = Anime.public_queryset().filter(season__iexact=season, season_year=year).count()
        rows.append(
            {
                "season": season,
                "year": year,
                "label": f"{season.title()} {year}",
                "role": ("previous", "current", "next", "later")[index],
                "listed": listed,
                "anilist": counted.get((season, year)),
            }
        )
    return rows


def catalog_overview() -> dict[str, Any]:
    counts = Anime.objects.aggregate(
        total=Count("id"),
        listed=Count("id", filter=Q(catalog_excluded="")),
        hydrated=Count("id", filter=Q(catalog_excluded="", hydrated_at__isnull=False)),
        waiting=Count("id", filter=Q(hydrate_requested_at__isnull=False)),
    )
    hidden_reasons = list(
        Anime.objects.exclude(catalog_excluded="")
        .values("catalog_excluded")
        .annotate(count=Count("id"))
        .order_by("-count")[:8]
    )

    lanes = []
    for lane, label, schedule, description in LANE_INFO:
        runs = CatalogRun.objects.filter(lane=lane)
        last = runs.order_by("-started_at").first()
        last_ok = runs.filter(status=CatalogRun.Status.SUCCEEDED).order_by("-started_at").first()
        last_change = (
            runs.filter(Q(created__gt=0) | Q(updated__gt=0) | Q(excluded__gt=0))
            .order_by("-started_at")
            .first()
        )
        lanes.append(
            {
                "lane": lane,
                "label": label,
                "schedule": schedule,
                "description": description,
                "running": is_running(lane),
                "last_run": serialize_run(last),
                "last_success_at": last_ok.started_at if last_ok else None,
                "last_change_at": last_change.started_at if last_change else None,
            }
        )

    delta_since = load_cursor("delta").get("since")
    return {
        "totals": {
            "total": counts["total"],
            "listed": counts["listed"],
            "hidden": counts["total"] - counts["listed"],
            "hydrated": counts["hydrated"],
            "waiting_for_details": counts["waiting"],
        },
        "hidden_reasons": [
            {"reason": row["catalog_excluded"], "count": row["count"]} for row in hidden_reasons
        ],
        "rules": {"countries": scope.countries(), "excluded_formats": scope.excluded_formats()},
        "seasons": _season_rows(),
        "sweep": seed_progress(),
        "changes_since": utc_from_timestamp(int(delta_since)) if delta_since else None,
        "lanes": lanes,
    }
