"""One set of list-entry transition rules, used by the API serializer and the importers (spec 3 P0-8).

``normalize_entry`` takes the incoming (partial) fields for one entry and returns them
completed with what follows from them: auto-complete at full progress, start/finish
dates, rewatch bookkeeping. The frontend never re-implements these; it sends what the
user did and shows what comes back.

Two modes:
- ``strict=True`` (API): out-of-range values raise ``ListRuleError`` (a 400), and dates
  are filled in automatically.
- ``strict=False`` (imports): values are clamped or dropped instead of rejected, and no
  dates are invented (an import of an old list must not stamp today on every entry).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

from ..models import UserAnimeList

if TYPE_CHECKING:
    from ...animes.models import Anime

Status = UserAnimeList.UserAnimeStatus

MAX_NOTES_LENGTH = 5000
# When the episode count is unknown (airing, not announced), cap progress here.
MAX_EPISODES_UNKNOWN_TOTAL = 10000
MIN_ENTRY_DATE = date(1960, 1, 1)


class ListRuleError(ValueError):
    """A field value the API must reject (strict mode only)."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


@dataclass(frozen=True, slots=True)
class _Current:
    status: str | None
    episodes_watched: int
    started_at: date | None
    finished_at: date | None
    total_rewatches: int
    is_rewatching: bool


def _current(instance: UserAnimeList | None) -> _Current:
    if instance is None:
        return _Current(None, 0, None, None, 0, False)
    return _Current(
        instance.status,
        instance.episodes_watched,
        instance.started_at,
        instance.finished_at,
        instance.total_rewatches,
        instance.is_rewatching,
    )


def user_today(user: Any) -> date:
    """Today in the user's profile timezone (UTC when the profile has none or it is invalid)."""
    profile = getattr(user, "userprofile", None) if user is not None else None
    name = (getattr(profile, "preferred_timezone", "") or "").strip()
    if name:
        try:
            return timezone.localdate(timezone=ZoneInfo(name))
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return timezone.now().date()


def _known_total(anime: Anime | None) -> int | None:
    total = int(getattr(anime, "episode_count", 0) or 0)
    return total if total > 0 else None


def _aired_so_far(anime: Anime | None) -> int | None:
    """Episodes out so far for a show still airing (``None`` when not known).

    Everything before ``next_airing_episode`` has aired. The airing fields stay on an
    episode until the background sync advances them, so once ``next_airing_date`` has
    passed that episode is out too. Without a date nothing reliable is known. The
    frontend reads the same rule (``airingState`` in ``frontend/src/utils/episodes.js``).
    """
    next_episode = getattr(anime, "next_airing_episode", None)
    next_date = getattr(anime, "next_airing_date", None)
    if not next_episode or next_date is None:
        return None
    next_episode = int(next_episode)
    aired = next_episode if next_date <= timezone.now() else next_episode - 1
    return max(aired, 0)


def _completion_target(total: int | None, aired: int | None) -> int | None:
    """Where Completed puts progress: every aired episode of a show still airing, else all."""
    if aired is not None and (total is None or aired < total):
        return aired
    return total


def _check_episodes(value: int, total: int | None, *, strict: bool) -> int:
    limit = total if total is not None else MAX_EPISODES_UNKNOWN_TOTAL
    if value < 0:
        if strict:
            raise ListRuleError("episodes_watched", "Episodes watched cannot be negative.")
        return 0
    if value > limit:
        if strict:
            if total is not None:
                message = f"Episodes watched cannot exceed total episodes ({total})."
            else:
                message = f"Episodes watched cannot exceed {MAX_EPISODES_UNKNOWN_TOTAL}."
            raise ListRuleError("episodes_watched", message)
        return limit
    return value


def _check_date(field: str, value: date | None, today: date, *, strict: bool) -> date | None:
    if value is None:
        return None
    if MIN_ENTRY_DATE <= value <= today + timedelta(days=1):
        return value
    if strict:
        raise ListRuleError(field, "Enter a date between 1960-01-01 and today.")
    return None


def _check_notes(value: str, *, strict: bool) -> str:
    if len(value) <= MAX_NOTES_LENGTH:
        return value
    if strict:
        raise ListRuleError("notes", f"Notes can be at most {MAX_NOTES_LENGTH} characters.")
    return value[:MAX_NOTES_LENGTH]


def normalize_entry(
    instance: UserAnimeList | None,
    attrs: dict[str, Any],
    anime: Anime | None,
    today: date,
    *,
    strict: bool = True,
    prefer_incoming_dates: bool = False,
) -> dict[str, Any]:
    """Return ``attrs`` completed by the transition rules (a new dict; ``attrs`` is not changed).

    ``instance`` is the existing entry (``None`` on create). Only the fields present in
    ``attrs`` count as "sent"; derived fields are added to the result.
    """
    result = dict(attrs)
    current = _current(instance)
    total = _known_total(anime)
    completion_target = _completion_target(total, _aired_so_far(anime))
    # Below this a Completed entry is being watched again (the total, or the aired count
    # when the total is not announced yet).
    completed_floor = total if total is not None else completion_target
    status_sent = "status" in result
    episodes_sent = "episodes_watched" in result

    if "notes" in result and result["notes"] is not None:
        result["notes"] = _check_notes(result["notes"], strict=strict)
    for field in ("started_at", "finished_at"):
        if field in result:
            result[field] = _check_date(field, result[field], today, strict=strict)

    status = result.get("status", current.status) or Status.plan_to_watch
    episodes = result.get("episodes_watched", current.episodes_watched) or 0
    if episodes_sent:
        episodes = _check_episodes(episodes, total, strict=strict)
    is_rewatching = result.get("is_rewatching", current.is_rewatching)
    total_rewatches = result.get("total_rewatches", current.total_rewatches) or 0

    # Starting a rewatch: back to Watching from episode 0 (the old progress stays in the
    # activity history). A sent progress below the total is kept, so a modal that sends
    # every field at once does not complete the rewatch it just started.
    starting_rewatch = bool(is_rewatching) and not current.is_rewatching
    if starting_rewatch:
        status = Status.watching
        if not (episodes_sent and (total is None or episodes < total)):
            episodes = 0
    elif episodes_sent and total is not None and episodes == total:
        # Every episode watched means Completed, whatever status came with it.
        status = Status.completed
    elif (
        episodes_sent
        and not status_sent
        and current.status == Status.completed
        and completed_floor is not None
        and episodes < completed_floor
        and episodes != current.episodes_watched
    ):
        # Progress moved below the end on a finished entry: it is being watched again
        # (lowered, or new episodes of a show completed while airing). Re-sending the
        # same progress changes nothing.
        status = Status.watching
    elif not status_sent and status == Status.plan_to_watch and episodes > 0 and episodes_sent:
        status = Status.watching

    if status == Status.completed:
        if completion_target is not None and completion_target == total:
            episodes = total
        elif completion_target is not None:
            # Still airing: fill up to the aired episodes, never lowering progress the
            # user already has (they may have watched ahead of our airing data).
            episodes = max(episodes, completion_target)
        becoming_completed = current.status != Status.completed or current.is_rewatching
        if becoming_completed and is_rewatching and not starting_rewatch:
            total_rewatches += 1
            is_rewatching = False
        if becoming_completed and strict:
            finished = result.get("finished_at", current.finished_at)
            if finished is None:
                started = result.get("started_at", current.started_at)
                # A start date may be up to tomorrow; the invented finish never precedes it.
                result["finished_at"] = max(today, started) if started else today

    if status == Status.watching and strict and current.status != Status.watching:
        started = result.get("started_at", current.started_at)
        finished = result.get("finished_at", current.finished_at)
        # Invent a start date only where it fits: an entry finished in the past (a
        # rewatch of an imported title) keeps its finish date and gets no start date.
        if started is None and (finished is None or finished >= today):
            result["started_at"] = today

    started = result.get("started_at", current.started_at)
    finished = result.get("finished_at", current.finished_at)
    if started and finished and finished < started:
        # Automatic dates are placed so they never break the order, and stored rows
        # satisfy the CHECK constraint, so a sent date is the cause here.
        if strict:
            raise ListRuleError("finished_at", "Finish date cannot be earlier than start date.")
        # Imports never move a date the entry already has: an incoming date that
        # contradicts a kept one is dropped. Two incoming dates that cross each other
        # (a bad source row) keep the start, and the finish moves to it.
        # ``prefer_incoming_dates`` (a newer remote row) clears the kept date instead.
        if "started_at" in result and "finished_at" not in result:
            if prefer_incoming_dates:
                result["finished_at"] = None
            else:
                del result["started_at"]
        elif "finished_at" in result and "started_at" not in result:
            if prefer_incoming_dates:
                result["started_at"] = None
            else:
                del result["finished_at"]
        else:
            result["finished_at"] = started

    result["status"] = status
    if episodes != current.episodes_watched or episodes_sent or instance is None:
        result["episodes_watched"] = episodes
    if is_rewatching != current.is_rewatching or "is_rewatching" in attrs:
        result["is_rewatching"] = bool(is_rewatching)
    if total_rewatches != current.total_rewatches or "total_rewatches" in attrs:
        result["total_rewatches"] = total_rewatches
    return result
