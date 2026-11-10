"""Offline sync stages: their state fields, results and the retry policy.

``OfflineSyncPolicy`` is mixed into ``OfflineSyncService``: given a stage's
result and attempt count it decides the backoff, quarantine and next stage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.utils import timezone

from ..models import OfflineAnimeSyncState

STAGE_METADATA = "metadata"
STAGE_FRANCHISE = "franchise"
STAGE_THEMES = "themes"
STAGES = (STAGE_METADATA, STAGE_FRANCHISE, STAGE_THEMES)

STATUS_FIELD_BY_STAGE = {
    STAGE_METADATA: "metadata_status",
    STAGE_FRANCHISE: "franchise_status",
    STAGE_THEMES: "themes_status",
}

ATTEMPT_FIELD_BY_STAGE = {
    STAGE_METADATA: "metadata_attempt_count",
    STAGE_FRANCHISE: "franchise_attempt_count",
    STAGE_THEMES: "themes_attempt_count",
}

TRANSIENT_REASON_CODES = {"rate_limited", "transport_error"}
NON_RETRYABLE_REASON_CODES = {"invalid_variable", "not_found"}
BLOCKED_REASON_CODES = {"identity_conflict", "missing_ids", "invalid_ids"}

FAST_RETRY_SECONDS = [60, 300, 900]
RATE_LIMIT_RETRY_SECONDS = [300, 900, 1800]
MAX_BACKOFF_SECONDS = 24 * 60 * 60
NON_RETRYABLE_BACKOFF_SECONDS = [1800, 21600, 86400]
NON_RETRYABLE_QUARANTINE_THRESHOLD = 2
BLOCKED_QUARANTINE_THRESHOLD = 2
TRANSIENT_QUARANTINE_THRESHOLD = 12
IN_PROGRESS_LEASE_SECONDS = 10 * 60
STATE_BULK_CREATE_BATCH_SIZE = 500


@dataclass(slots=True)
class StageClaim:
    state_id: int
    stage: str
    retry_age_seconds: float | None


@dataclass(slots=True)
class StageResult:
    status: str
    reason_code: str = ""
    reason_message: str = ""
    transient: bool = False


class OfflineSyncPolicy:
    """Retry, backoff and quarantine decisions for one stage attempt."""

    inter_stage_delay_seconds: int

    def _stage_result_from_external_error(self, *, code: str, message: str) -> StageResult:
        reason_code = (code or "transport_error").strip()
        if reason_code in TRANSIENT_REASON_CODES:
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR,
                reason_code=reason_code,
                reason_message=message,
                transient=True,
            )

        if reason_code == "identity_conflict":
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                reason_code=reason_code,
                reason_message=message,
            )

        return StageResult(
            status=OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS,
            reason_code=reason_code,
            reason_message=message,
        )

    def _next_attempt_after_success(self, state: OfflineAnimeSyncState):
        next_stage = self._next_stage(state)
        if next_stage:
            return timezone.now() + timedelta(seconds=self.inter_stage_delay_seconds)
        return timezone.now() + timedelta(days=36500)

    def _next_stage(self, state: OfflineAnimeSyncState) -> str | None:
        for stage in STAGES:
            status = getattr(state, STATUS_FIELD_BY_STAGE[stage])
            if status == OfflineAnimeSyncState.StageStatus.SYNCED:
                continue
            if status == OfflineAnimeSyncState.StageStatus.QUARANTINED:
                return None
            return stage
        return None

    def _compute_backoff_seconds(self, *, reason_code: str, attempts: int, transient: bool) -> int:
        if reason_code == "rate_limited":
            if attempts <= len(RATE_LIMIT_RETRY_SECONDS):
                return RATE_LIMIT_RETRY_SECONDS[attempts - 1]
            exp_index = attempts - len(RATE_LIMIT_RETRY_SECONDS)
            return min(MAX_BACKOFF_SECONDS, RATE_LIMIT_RETRY_SECONDS[-1] * (2**exp_index))

        if transient or reason_code in TRANSIENT_REASON_CODES:
            if attempts <= len(FAST_RETRY_SECONDS):
                return FAST_RETRY_SECONDS[attempts - 1]
            exp_index = attempts - len(FAST_RETRY_SECONDS)
            return min(MAX_BACKOFF_SECONDS, FAST_RETRY_SECONDS[-1] * (2**exp_index))

        idx = min(attempts - 1, len(NON_RETRYABLE_BACKOFF_SECONDS) - 1)
        return NON_RETRYABLE_BACKOFF_SECONDS[idx]

    def _should_quarantine(self, *, result: StageResult, attempts: int) -> bool:
        if result.reason_code in BLOCKED_REASON_CODES:
            return attempts >= BLOCKED_QUARANTINE_THRESHOLD
        if result.reason_code in NON_RETRYABLE_REASON_CODES:
            return attempts >= NON_RETRYABLE_QUARANTINE_THRESHOLD
        if result.transient or result.reason_code in TRANSIENT_REASON_CODES:
            return attempts >= TRANSIENT_QUARANTINE_THRESHOLD
        return attempts >= NON_RETRYABLE_QUARANTINE_THRESHOLD
