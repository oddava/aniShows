"""The one entry shape every import source produces, and the source-specific parsers into it.

AniList, the MAL API and MAL XML each map their rows to ``ImportedEntry``; the shared
importer (``base.py``) resolves, merges and writes them the same way.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from django.utils.dateparse import parse_datetime

from ...models import UserAnimeList

Status = UserAnimeList.UserAnimeStatus

# Why an entry could not be imported (``UserImportJob.unmatched[].reason``).
REASON_NOT_IN_CATALOG_YET = "not_in_catalog_yet"
REASON_NOT_FOUND = "not_found"
REASON_UNKNOWN_STATUS = "unknown_status"
REASON_INVALID = "invalid"
# Animation the catalog does not list (made outside Japan, a music video): the entry
# is left out, and the title is never added to the catalog for it.
REASON_OUTSIDE_CATALOG = "outside_catalog"

ANILIST_STATUS = {
    "CURRENT": Status.watching,
    "REPEATING": Status.watching,
    "COMPLETED": Status.completed,
    "PAUSED": Status.on_hold,
    "DROPPED": Status.dropped,
    "PLANNING": Status.plan_to_watch,
}
MAL_API_STATUS = {
    "watching": Status.watching,
    "completed": Status.completed,
    "on_hold": Status.on_hold,
    "dropped": Status.dropped,
    "plan_to_watch": Status.plan_to_watch,
}
MAL_XML_STATUS = {
    "Watching": Status.watching,
    "Completed": Status.completed,
    "On-Hold": Status.on_hold,
    "Dropped": Status.dropped,
    "Plan to Watch": Status.plan_to_watch,
    # Numeric codes some exporters write.
    "1": Status.watching,
    "2": Status.completed,
    "3": Status.on_hold,
    "4": Status.dropped,
    "6": Status.plan_to_watch,
}


@dataclass(slots=True)
class ImportedEntry:
    status: str | None
    title: str = ""
    anilist_id: int | None = None
    mal_id: int | None = None
    score: int = 0  # 0..10; 0 = not rated
    progress: int = 0
    started: date | None = None
    finished: date | None = None
    repeat: int = 0
    is_rewatching: bool = False
    notes: str = ""
    # When the entry last changed on the source; ``None`` when the source does not say
    # (MAL XML), which makes the merge fill empty local fields only.
    remote_updated_at: datetime | None = None
    raw_status: str = field(default="", repr=False)

    def key(self) -> tuple:
        if self.anilist_id:
            return ("anilist", self.anilist_id)
        if self.mal_id:
            return ("mal", self.mal_id)
        return ("title", self.title.strip().lower())

    def unmatched(self, reason: str) -> dict[str, Any]:
        return {
            "title": self.title[:200],
            "mal_id": self.mal_id,
            "anilist_id": self.anilist_id,
            "reason": reason,
        }

    def to_payload(self) -> dict[str, Any]:
        data = asdict(self)
        data["started"] = self.started.isoformat() if self.started else None
        data["finished"] = self.finished.isoformat() if self.finished else None
        data["remote_updated_at"] = (
            self.remote_updated_at.isoformat() if self.remote_updated_at else None
        )
        return data

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> ImportedEntry:
        values = dict(data)
        values["started"] = _iso_date(values.get("started"))
        values["finished"] = _iso_date(values.get("finished"))
        stamp = values.get("remote_updated_at")
        values["remote_updated_at"] = parse_datetime(stamp) if stamp else None
        known = set(cls.__dataclass_fields__)
        return cls(**{key: value for key, value in values.items() if key in known})


def _iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _int(value: Any) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def _positive_id(value: Any) -> int | None:
    number = _int(value)
    return number or None


def score_from_point_100(value: Any) -> int:
    """AniList ``score(format: POINT_100)`` → 0..10, rounding half up (75 → 8, 5 → 1)."""
    try:
        points = float(value or 0)
    except (TypeError, ValueError):
        return 0
    if points <= 0:
        return 0
    return min(max(int(points / 10 + 0.5), 1), 10)


def score_from_ten(value: Any) -> int:
    return min(_int(value), 10)


def fuzzy_date(value: Any) -> date | None:
    """AniList ``FuzzyDate`` ``{year, month, day}``; a missing month or day means unknown."""
    if not isinstance(value, dict):
        return None
    try:
        return date(int(value["year"]), int(value["month"]), int(value["day"]))
    except (KeyError, TypeError, ValueError):
        return None


def mal_date(value: Any) -> date | None:
    """MAL ``YYYY-MM-DD`` where ``0000-00-00`` or a ``00`` part means unknown."""
    text = str(value or "").strip()
    if not text or text.startswith("0000"):
        return None
    parts = text.split("-")
    if len(parts) != 3 or "00" in (parts[1], parts[2]):
        return None
    return _iso_date(text)


def anilist_entry(row: dict[str, Any]) -> ImportedEntry:
    """One ``MediaList`` row (see ``anilist_fetch.ENTRY_FIELDS``)."""
    media = row.get("media") or {}
    titles = media.get("title") or {}
    raw_status = str(row.get("status") or "")
    updated = row.get("updatedAt")
    return ImportedEntry(
        status=ANILIST_STATUS.get(raw_status),
        raw_status=raw_status,
        title=titles.get("romaji") or titles.get("english") or titles.get("native") or "",
        anilist_id=_positive_id(row.get("mediaId") or media.get("id")),
        mal_id=_positive_id(media.get("idMal")),
        score=score_from_point_100(row.get("score")),
        progress=_int(row.get("progress")),
        started=fuzzy_date(row.get("startedAt")),
        finished=fuzzy_date(row.get("completedAt")),
        repeat=_int(row.get("repeat")),
        is_rewatching=raw_status == "REPEATING",
        notes=str(row.get("notes") or ""),
        remote_updated_at=datetime.fromtimestamp(int(updated), tz=UTC) if updated else None,
    )


def mal_api_entry(item: dict[str, Any]) -> ImportedEntry:
    node = item.get("node") or {}
    list_status = item.get("list_status") or {}
    raw_status = str(list_status.get("status") or "")
    updated = list_status.get("updated_at")
    return ImportedEntry(
        status=MAL_API_STATUS.get(raw_status),
        raw_status=raw_status,
        title=str(node.get("title") or ""),
        mal_id=_positive_id(node.get("id")),
        score=score_from_ten(list_status.get("score")),
        progress=_int(list_status.get("num_episodes_watched")),
        started=mal_date(list_status.get("start_date")),
        finished=mal_date(list_status.get("finish_date")),
        repeat=_int(list_status.get("num_times_rewatched")),
        is_rewatching=bool(list_status.get("is_rewatching")),
        notes=str(list_status.get("comments") or ""),
        remote_updated_at=parse_datetime(updated) if updated else None,
    )


def mal_xml_entry(element) -> ImportedEntry:
    """One ``<anime>`` element of a MAL export (parsed with defusedxml)."""

    def text(tag: str) -> str:
        child = element.find(tag)
        return (child.text or "").strip() if child is not None and child.text else ""

    raw_status = text("my_status")
    return ImportedEntry(
        status=MAL_XML_STATUS.get(raw_status),
        raw_status=raw_status,
        title=text("series_title"),
        mal_id=_positive_id(text("series_animedb_id")),
        score=score_from_ten(text("my_score")),
        progress=_int(text("my_watched_episodes")),
        started=mal_date(text("my_start_date")),
        finished=mal_date(text("my_finish_date")),
        repeat=_int(text("my_times_watched")),
        is_rewatching=text("my_rewatching") in {"1", "true", "True"},
        notes=text("my_comments"),
    )
