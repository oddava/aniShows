"""Review moderation queue (G6 P1-1).

The queue lists one row per review that has at least one user report matching the
filter. Heuristic signals (low rating, spoiler tag, empty text) never count as
reports; they are an opt-in view (``signals=True``). Resolving a review updates
its open reports, applies the outcome to the review and writes one audit row, all
in one transaction. Review deletion goes through ``Review.delete()`` so G5's
signals run.

Forum reports are G5's: when ``apps.forums.services.moderation`` exists, the
summary counts them and the forum endpoints delegate to it.
"""

from __future__ import annotations

import importlib
import importlib.util
from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from ...animes.models import Review, ReviewReport
from ...core.models import AuditLog
from .audit import record_admin_action
from .query_helpers import related_count

if TYPE_CHECKING:
    from types import ModuleType

SNIPPET_LENGTH = 200
NOTES_MAX_LENGTH = 1000
OPEN_STATUSES = (ReviewReport.Status.OPEN, ReviewReport.Status.IN_REVIEW)
STATUS_FILTERS = {
    "open": OPEN_STATUSES,
    "in_review": (ReviewReport.Status.IN_REVIEW,),
    "resolved": (ReviewReport.Status.RESOLVED,),
    "dismissed": (ReviewReport.Status.DISMISSED,),
}
OUTCOME_DISMISS = "dismiss"
OUTCOME_REMOVE = "remove_review"
OUTCOME_SPOILER = "mark_spoiler"
OUTCOMES = (OUTCOME_DISMISS, OUTCOME_REMOVE, OUTCOME_SPOILER)
# Only the deprecated ``reviews/{id}/reports/resolve/`` endpoint: close the reports
# and leave the review as it is.
LEGACY_OUTCOME_RESOLVE = "resolve"
LOW_RATING_MAX = 3
FORUM_MODERATION_MODULE = "apps.forums.services.moderation"


class ModerationError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True, frozen=True)
class QueueFilters:
    statuses: tuple[str, ...]
    reason: str | None
    signals: bool


def parse_queue_filters(query_params) -> QueueFilters:
    status = query_params.get("status") or "open"
    if status not in STATUS_FILTERS:
        raise ModerationError(f"status must be one of: {', '.join(STATUS_FILTERS)}.", 400)
    reason = query_params.get("reason") or None
    if reason is not None and reason not in ReviewReport.Reason.values:
        raise ModerationError(
            f"reason must be one of: {', '.join(ReviewReport.Reason.values)}.", 400
        )
    signals = str(query_params.get("signals", "")).lower() in {"1", "true", "yes"}
    return QueueFilters(statuses=STATUS_FILTERS[status], reason=reason, signals=signals)


def _matching_reports(filters: QueueFilters):
    reports = ReviewReport.objects.filter(status__in=filters.statuses)
    if filters.reason:
        reports = reports.filter(reason=filters.reason)
    return reports


def reported_reviews_queryset(filters: QueueFilters):
    """One aggregate row per reported review, most recently reported first."""
    return (
        _matching_reports(filters)
        .values("review_id")
        .annotate(
            report_total=Count("id"),
            reporter_count=Count("reporter_id", distinct=True),
            first_reported_at=Min("created_at"),
            last_reported_at=Max("created_at"),
        )
        .order_by("-last_reported_at", "-review_id")
    )


def signal_reviews_queryset(filters: QueueFilters):
    """Reviews with a heuristic quality signal, reported or not (opt-in view)."""
    return (
        Review.objects.filter(
            Q(rating__lte=LOW_RATING_MAX) | Q(has_spoilers=True) | Q(text="") | Q(text__isnull=True)
        )
        .select_related("user", "anime")
        .annotate(_report_total=related_count(ReviewReport, "review", status__in=filters.statuses))
        .order_by("-created_at", "-id")
    )


def review_signals(review) -> list[str]:
    signals = []
    if review.rating <= LOW_RATING_MAX:
        signals.append("low_rating")
    if review.has_spoilers:
        signals.append("spoiler_tag")
    if not (review.text or "").strip():
        signals.append("empty_text")
    return signals


def _reason_counts(review_ids, filters: QueueFilters) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = {review_id: {} for review_id in review_ids}
    rows = (
        _matching_reports(filters)
        .filter(review_id__in=review_ids)
        .values_list("review_id", "reason")
        .annotate(total=Count("id"))
        .order_by()
    )
    for review_id, reason, total in rows:
        counts[review_id][reason] = total
    return counts


def _row(review, aggregate: dict, reasons: dict, signals: list[str]) -> dict:
    return {
        "review_id": review.id,
        "snippet": (review.text or "")[:SNIPPET_LENGTH],
        "rating": review.rating,
        "has_spoilers": review.has_spoilers,
        "created_at": review.created_at.isoformat(),
        "author": {"id": review.user_id, "username": review.user.username},
        "anime": {"id": review.anime_id, "title": review.anime.title, "slug": review.anime.slug},
        "report_counts": reasons,
        "report_total": aggregate.get("report_total", 0),
        "reporter_count": aggregate.get("reporter_count", 0),
        "first_reported_at": _iso(aggregate.get("first_reported_at")),
        "last_reported_at": _iso(aggregate.get("last_reported_at")),
        "signals": signals,
    }


def _iso(value):
    return value.isoformat() if value else None


def serialize_reported_page(page, filters: QueueFilters) -> list[dict]:
    """Rows for one page of ``reported_reviews_queryset`` (two more queries)."""
    aggregates = {item["review_id"]: item for item in page}
    reviews = Review.objects.select_related("user", "anime").in_bulk(list(aggregates))
    reasons = _reason_counts(list(aggregates), filters)
    return [
        _row(reviews[review_id], aggregate, reasons[review_id], [])
        for review_id, aggregate in aggregates.items()
        if review_id in reviews
    ]


def serialize_signal_page(page, filters: QueueFilters) -> list[dict]:
    reasons = _reason_counts([review.id for review in page], filters)
    return [
        _row(
            review,
            # One report per reporter and review (unique_together), so the counts match.
            {"report_total": review._report_total, "reporter_count": review._report_total},
            reasons[review.id],
            review_signals(review),
        )
        for review in page
    ]


def _clean_notes(raw) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise ModerationError("notes must be a string.", 400)
    notes = raw.strip()
    if len(notes) > NOTES_MAX_LENGTH:
        raise ModerationError(f"notes must be at most {NOTES_MAX_LENGTH} characters.", 400)
    return notes


def resolve_review(request, review_id, outcome, notes=None, *, legacy: bool = False) -> dict:
    """Close a review's open reports with ``outcome`` and audit it, atomically."""
    allowed = (*OUTCOMES, LEGACY_OUTCOME_RESOLVE) if legacy else OUTCOMES
    if outcome not in allowed:
        raise ModerationError(f"outcome must be one of: {', '.join(allowed)}.", 400)
    notes = _clean_notes(notes)
    try:
        review_pk = int(review_id)
    except (TypeError, ValueError):
        raise ModerationError("Review not found.", 404) from None

    with transaction.atomic():
        review = (
            Review.objects.select_for_update(of=("self",))
            .select_related("user", "anime")
            .filter(pk=review_pk)
            .first()
        )
        if review is None:
            raise ModerationError("Review not found.", 404)

        open_reports = ReviewReport.objects.filter(review=review, status__in=OPEN_STATUSES)
        reasons = dict(open_reports.values_list("reason").annotate(total=Count("id")).order_by())
        report_status = (
            ReviewReport.Status.DISMISSED
            if outcome == OUTCOME_DISMISS
            else ReviewReport.Status.RESOLVED
        )
        updated = open_reports.update(
            status=report_status,
            resolved_by=request.user,
            resolved_at=timezone.now(),
            resolution_notes=notes,
        )
        if updated == 0:
            raise ModerationError("This review has no open reports.", 409)

        snapshot = {
            "author": review.user.username,
            "anime": review.anime.title,
            "rating": review.rating,
            "has_spoilers": review.has_spoilers,
            "snippet": (review.text or "")[:SNIPPET_LENGTH],
        }
        new_state: dict = {}
        if outcome == OUTCOME_SPOILER and not review.has_spoilers:
            review.has_spoilers = True
            review.save(update_fields=["has_spoilers", "updated_at"])
            new_state = {"has_spoilers": True}
        elif outcome == OUTCOME_REMOVE:
            review.delete()
            new_state = {"deleted": True}

        record_admin_action(
            request,
            action=(
                AuditLog.ActionType.DISMISS
                if outcome == OUTCOME_DISMISS
                else AuditLog.ActionType.RESOLVE
            ),
            entity_type="Review",
            entity_id=review_pk,
            entity_repr=f"{snapshot['author']} on {snapshot['anime']}",
            previous=snapshot if new_state else None,
            new={**snapshot, **new_state} if new_state else None,
            metadata={
                "outcome": outcome,
                "reports_updated": updated,
                "report_reasons": reasons,
                "notes": notes,
            },
        )

    return {
        "review_id": review_pk,
        "outcome": outcome,
        "reports_updated": updated,
        "review_deleted": outcome == OUTCOME_REMOVE,
    }


def forum_moderation() -> ModuleType | None:
    """G5's forum moderation module, if it has shipped."""
    try:
        if importlib.util.find_spec(FORUM_MODERATION_MODULE) is None:
            return None
    except ModuleNotFoundError:
        return None
    return importlib.import_module(FORUM_MODERATION_MODULE)


def moderation_summary() -> dict:
    open_reports = ReviewReport.objects.filter(status__in=OPEN_STATUSES)
    totals = open_reports.aggregate(
        open_reports=Count("id"), open_reviews=Count("review_id", distinct=True)
    )
    by_reason = dict(open_reports.values_list("reason").annotate(total=Count("id")).order_by())
    forums = forum_moderation()
    return {
        **totals,
        "by_reason": by_reason,
        "forums": {"open": int(forums.open_count())} if forums is not None else None,
    }
