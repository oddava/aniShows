from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta

import httpx
from asgiref.sync import sync_to_async
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.animes.models import Anime, OfflineAnimeSyncState
from apps.animes.services.anilist import AniListService
from apps.animes.services.jikan import (
    JikanRateLimiter,
    fetch_themes_from_jikan_with_reason,
)
from apps.animes.services.metrics import (
    OFFLINE_SYNC_QUARANTINE_TOTAL,
    OFFLINE_SYNC_RETRY_AGE_SECONDS,
    OFFLINE_SYNC_STAGE_FAILURE_TOTAL,
    OFFLINE_SYNC_STAGE_SUCCESS_TOTAL,
)
from apps.shared.logger import logger

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
MAX_BACKOFF_SECONDS = 24 * 60 * 60
NON_RETRYABLE_BACKOFF_SECONDS = [1800, 21600, 86400]
NON_RETRYABLE_QUARANTINE_THRESHOLD = 3
BLOCKED_QUARANTINE_THRESHOLD = 2
TRANSIENT_QUARANTINE_THRESHOLD = 12
IN_PROGRESS_LEASE_SECONDS = 10 * 60


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


class OfflineSyncService:
    def ensure_states_for_anime_ids(
        self,
        anime_ids: list[int],
        *,
        reset_pipeline: bool = False,
    ) -> dict[str, int]:
        ids = sorted({int(anime_id) for anime_id in anime_ids if anime_id})
        if not ids:
            return {"created": 0, "updated": 0}

        existing = {
            row.anime_id: row
            for row in OfflineAnimeSyncState.objects.filter(anime_id__in=ids)
        }
        now = timezone.now()
        to_create = [
            OfflineAnimeSyncState(
                anime_id=anime_id,
                next_attempt_at=now,
            )
            for anime_id in ids
            if anime_id not in existing
        ]
        if to_create:
            OfflineAnimeSyncState.objects.bulk_create(to_create, ignore_conflicts=True)

        updated = 0
        if reset_pipeline:
            queryset = OfflineAnimeSyncState.objects.filter(anime_id__in=ids)
            updated = queryset.update(
                metadata_status=OfflineAnimeSyncState.StageStatus.PENDING,
                franchise_status=OfflineAnimeSyncState.StageStatus.PENDING,
                themes_status=OfflineAnimeSyncState.StageStatus.PENDING,
                metadata_attempt_count=0,
                franchise_attempt_count=0,
                themes_attempt_count=0,
                attempt_count=0,
                last_attempt_at=None,
                next_attempt_at=now,
                last_error_code="",
                last_error_message="",
                quarantined=False,
                quarantine_reason="",
                quarantine_context={},
            )

        return {"created": len(to_create), "updated": updated}

    def reconcile_due(
        self,
        *,
        batch_size: int = 500,
        anime_ids: list[int] | None = None,
    ) -> dict:
        claims = self._claim_due_states(batch_size=batch_size, anime_ids=anime_ids)

        stage_counts = {
            stage: {
                OfflineAnimeSyncState.StageStatus.SYNCED: 0,
                OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR: 0,
                OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY: 0,
                OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS: 0,
                OfflineAnimeSyncState.StageStatus.QUARANTINED: 0,
            }
            for stage in STAGES
        }
        reason_counts: dict[str, int] = {}
        processed = 0

        for claim in claims:
            if claim.retry_age_seconds is not None:
                OFFLINE_SYNC_RETRY_AGE_SECONDS.labels(stage=claim.stage).observe(
                    max(claim.retry_age_seconds, 0.0)
                )
            outcome = self._execute_claim(claim)
            if not outcome:
                continue
            processed += 1
            stage = outcome["stage"]
            status = outcome["status"]
            reason = outcome.get("reason_code") or ""
            stage_counts[stage][status] = stage_counts[stage].get(status, 0) + 1
            if reason:
                reason_counts[reason] = reason_counts.get(reason, 0) + 1

        summary = self._state_summary(anime_ids=anime_ids)
        return {
            "processed": processed,
            "claimed": len(claims),
            "stage_counts": stage_counts,
            "reason_counts": reason_counts,
            "pending": summary["pending"],
            "complete": summary["complete"],
            "transient_backlog": summary["transient_backlog"],
            "quarantined_count": summary["quarantined_count"],
            "top_quarantine_reasons": summary["top_quarantine_reasons"],
        }

    def _due_queryset(self, *, anime_ids: list[int] | None):
        now = timezone.now()
        queryset = OfflineAnimeSyncState.objects.select_related("anime").filter(
            anime__offline_db_last_seen_at__isnull=False,
            quarantined=False,
            next_attempt_at__lte=now,
        )
        if anime_ids:
            queryset = queryset.filter(anime_id__in=anime_ids)
        return queryset.order_by("next_attempt_at", "id")

    def _claim_due_states(
        self,
        *,
        batch_size: int,
        anime_ids: list[int] | None,
    ) -> list[StageClaim]:
        if batch_size <= 0:
            batch_size = 100

        claims: list[StageClaim] = []
        now = timezone.now()
        stale_cutoff = now - timedelta(seconds=IN_PROGRESS_LEASE_SECONDS)

        with transaction.atomic():
            rows = list(
                self._due_queryset(anime_ids=anime_ids)
                .select_for_update(skip_locked=True)[:batch_size]
            )
            for state in rows:
                stage = self._next_stage(state)
                if not stage:
                    continue

                status_field = STATUS_FIELD_BY_STAGE[stage]
                current_status = getattr(state, status_field)
                if current_status == OfflineAnimeSyncState.StageStatus.IN_PROGRESS:
                    if state.last_attempt_at and state.last_attempt_at > stale_cutoff:
                        continue
                    setattr(state, status_field, OfflineAnimeSyncState.StageStatus.PENDING)

                retry_age = None
                if state.last_attempt_at:
                    retry_age = (now - state.last_attempt_at).total_seconds()

                setattr(state, status_field, OfflineAnimeSyncState.StageStatus.IN_PROGRESS)
                state.last_attempt_at = now
                state.next_attempt_at = now + timedelta(seconds=IN_PROGRESS_LEASE_SECONDS)
                state.save(
                    update_fields=[
                        status_field,
                        "last_attempt_at",
                        "next_attempt_at",
                        "updated_at",
                    ]
                )
                claims.append(StageClaim(state_id=state.id, stage=stage, retry_age_seconds=retry_age))

        return claims

    def _execute_claim(self, claim: StageClaim) -> dict | None:
        try:
            state = OfflineAnimeSyncState.objects.select_related("anime").get(id=claim.state_id)
        except OfflineAnimeSyncState.DoesNotExist:
            return None

        if claim.stage == STAGE_METADATA:
            result = self.sync_metadata_stage(state.anime)
        elif claim.stage == STAGE_FRANCHISE:
            result = self.sync_franchise_stage(state.anime)
        else:
            result = self.sync_themes_stage(state.anime)

        return self._apply_stage_result(state_id=state.id, stage=claim.stage, result=result)

    def sync_metadata_stage(self, anime: Anime) -> StageResult:
        if anime.anilist_id in (None, 0) and anime.mal_id in (None, 0):
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS,
                reason_code="missing_ids",
                reason_message="Neither AniList ID nor MAL ID is set.",
            )
        return asyncio.run(self._sync_metadata_stage_async(anime))

    async def _sync_metadata_stage_async(self, anime: Anime) -> StageResult:
        service = AniListService(enable_caching=False, enable_rate_limiting=True)
        try:
            media = None
            if anime.anilist_id:
                media = await service.get_anime_by_id(anime.anilist_id)
                if media and media.get("id") != anime.anilist_id:
                    return StageResult(
                        status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                        reason_code="identity_conflict",
                        reason_message=(
                            f"AniList mismatch: expected {anime.anilist_id}, got {media.get('id')}"
                        ),
                    )
                if media and anime.mal_id and media.get("idMal") and media.get("idMal") != anime.mal_id:
                    return StageResult(
                        status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                        reason_code="identity_conflict",
                        reason_message=(
                            f"MAL mismatch: expected {anime.mal_id}, got {media.get('idMal')}"
                        ),
                    )
            elif anime.mal_id:
                media = await service.search_by_mal_id(anime.mal_id)
                if media and media.get("idMal") != anime.mal_id:
                    return StageResult(
                        status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                        reason_code="identity_conflict",
                        reason_message=(
                            f"MAL mismatch: expected {anime.mal_id}, got {media.get('idMal')}"
                        ),
                    )

            if not media:
                return self._stage_result_from_external_error(
                    code=service.last_error_code or "not_found",
                    message=service.last_error_message or "AniList media not found.",
                )

            updated = await service.update_anime_manual(anime, media)
            if not updated:
                return StageResult(
                    status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                    reason_code="identity_conflict",
                    reason_message="AniList update rejected due to identity conflict.",
                )

            return StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)
        except Exception as exc:
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR,
                reason_code="transport_error",
                reason_message=str(exc),
                transient=True,
            )
        finally:
            await service.close()

    def sync_franchise_stage(self, anime: Anime) -> StageResult:
        if not anime.anilist_id:
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS,
                reason_code="missing_ids",
                reason_message="AniList ID is required for franchise stage.",
            )
        return asyncio.run(self._sync_franchise_stage_async(anime))

    async def _sync_franchise_stage_async(self, anime: Anime) -> StageResult:
        service = AniListService(enable_caching=False, enable_rate_limiting=True)
        try:
            media = await service.get_anime_by_id(anime.anilist_id)
            if not media:
                return self._stage_result_from_external_error(
                    code=service.last_error_code or "not_found",
                    message=service.last_error_message or "AniList media not found.",
                )
            if media.get("id") != anime.anilist_id:
                return StageResult(
                    status=OfflineAnimeSyncState.StageStatus.BLOCKED_IDENTITY,
                    reason_code="identity_conflict",
                    reason_message=(
                        f"AniList mismatch: expected {anime.anilist_id}, got {media.get('id')}"
                    ),
                )

            relation_edges = (media.get("relations") or {}).get("edges", [])
            anime_relations = [
                edge for edge in relation_edges if (edge.get("node") or {}).get("type") == "ANIME"
            ]
            current_relations = anime.relations or []
            current_map = {row.get("id"): row for row in current_relations if row.get("id")}
            relation_ids = {
                (edge.get("node") or {}).get("id")
                for edge in anime_relations
                if (edge.get("node") or {}).get("id")
            }

            slug_map = await sync_to_async(
                lambda: {
                    row["anilist_id"]: row["slug"]
                    for row in Anime.objects.filter(anilist_id__in=relation_ids).values(
                        "anilist_id",
                        "slug",
                    )
                }
            )()

            new_relations = []
            for edge in anime_relations:
                node = edge.get("node") or {}
                related_anilist_id = node.get("id")
                title_data = node.get("title") or {}
                relation_entry = {
                    "id": related_anilist_id,
                    "type": edge.get("relationType"),
                    "title": title_data.get("english")
                    or title_data.get("romaji")
                    or title_data.get("native")
                    or "Unknown",
                    "format": node.get("format"),
                    "status": node.get("status"),
                    "cover": (node.get("coverImage") or {}).get("large"),
                    "slug": None,
                }
                if related_anilist_id in current_map and current_map[related_anilist_id].get("slug"):
                    relation_entry["slug"] = current_map[related_anilist_id]["slug"]
                elif related_anilist_id in slug_map:
                    relation_entry["slug"] = slug_map[related_anilist_id]
                new_relations.append(relation_entry)

            anime.relations = new_relations
            await sync_to_async(anime.save)(update_fields=["relations", "updated_at"])
            return StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)
        except Exception as exc:
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR,
                reason_code="transport_error",
                reason_message=str(exc),
                transient=True,
            )
        finally:
            await service.close()

    def sync_themes_stage(self, anime: Anime) -> StageResult:
        if not anime.mal_id or not isinstance(anime.mal_id, int) or anime.mal_id <= 0:
            return StageResult(
                status=OfflineAnimeSyncState.StageStatus.BLOCKED_NO_IDS,
                reason_code="invalid_ids",
                reason_message=f"Invalid MAL ID: {anime.mal_id}",
            )
        return asyncio.run(self._sync_themes_stage_async(anime))

    async def _sync_themes_stage_async(self, anime: Anime) -> StageResult:
        rate_limiter = JikanRateLimiter(base_delay=0.8)
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            result = await fetch_themes_from_jikan_with_reason(
                http_client=http_client,
                mal_id=anime.mal_id,
                rate_limiter=rate_limiter,
                max_retries=3,
            )
            if not result.success:
                return self._stage_result_from_external_error(
                    code=result.reason_code or "transport_error",
                    message=result.message or "Jikan request failed.",
                )

            themes = result.themes or {"openings": [], "endings": []}
            openings = themes.get("openings", [])
            endings = themes.get("endings", [])
            if openings or endings:
                from apps.animes.tasks.themes import ThemeSongSyncTask

                task = ThemeSongSyncTask()
                await task._save_theme_songs(anime, themes)

            return StageResult(status=OfflineAnimeSyncState.StageStatus.SYNCED)

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

    def _apply_stage_result(self, *, state_id: int, stage: str, result: StageResult) -> dict:
        status_field = STATUS_FIELD_BY_STAGE[stage]
        attempt_field = ATTEMPT_FIELD_BY_STAGE[stage]
        now = timezone.now()

        with transaction.atomic():
            state = OfflineAnimeSyncState.objects.select_for_update().get(id=state_id)
            setattr(state, attempt_field, getattr(state, attempt_field) + 1)
            state.attempt_count += 1
            stage_attempts = getattr(state, attempt_field)
            state.last_error_code = result.reason_code or ""
            state.last_error_message = result.reason_message or ""

            if result.status == OfflineAnimeSyncState.StageStatus.SYNCED:
                setattr(state, status_field, OfflineAnimeSyncState.StageStatus.SYNCED)
                state.last_error_code = ""
                state.last_error_message = ""
                state.next_attempt_at = self._next_attempt_after_success(state)
                state.save(
                    update_fields=[
                        status_field,
                        attempt_field,
                        "attempt_count",
                        "last_error_code",
                        "last_error_message",
                        "next_attempt_at",
                        "updated_at",
                    ]
                )
                OFFLINE_SYNC_STAGE_SUCCESS_TOTAL.labels(stage=stage).inc()
                return {
                    "stage": stage,
                    "status": OfflineAnimeSyncState.StageStatus.SYNCED,
                    "reason_code": "",
                }

            quarantined = self._should_quarantine(result=result, attempts=stage_attempts)
            if quarantined:
                setattr(state, status_field, OfflineAnimeSyncState.StageStatus.QUARANTINED)
                state.quarantined = True
                state.quarantine_reason = result.reason_code or "quarantined"
                state.quarantine_context = {
                    "stage": stage,
                    "attempts": stage_attempts,
                    "message": result.reason_message[:500],
                }
                state.next_attempt_at = now + timedelta(days=36500)
                state.save(
                    update_fields=[
                        status_field,
                        attempt_field,
                        "attempt_count",
                        "quarantined",
                        "quarantine_reason",
                        "quarantine_context",
                        "last_error_code",
                        "last_error_message",
                        "next_attempt_at",
                        "updated_at",
                    ]
                )
                OFFLINE_SYNC_STAGE_FAILURE_TOTAL.labels(
                    stage=stage, reason=result.reason_code or "unknown"
                ).inc()
                OFFLINE_SYNC_QUARANTINE_TOTAL.labels(
                    stage=stage, reason=result.reason_code or "unknown"
                ).inc()
                self._log_stage_failure(
                    anime=state.anime,
                    stage=stage,
                    reason_code=result.reason_code or "unknown",
                    message=result.reason_message,
                    quarantined=True,
                )
                return {
                    "stage": stage,
                    "status": OfflineAnimeSyncState.StageStatus.QUARANTINED,
                    "reason_code": result.reason_code or "unknown",
                }

            setattr(state, status_field, result.status)
            backoff_seconds = self._compute_backoff_seconds(
                reason_code=result.reason_code,
                attempts=stage_attempts,
                transient=result.transient,
            )
            state.next_attempt_at = now + timedelta(seconds=backoff_seconds)
            state.save(
                update_fields=[
                    status_field,
                    attempt_field,
                    "attempt_count",
                    "last_error_code",
                    "last_error_message",
                    "next_attempt_at",
                    "updated_at",
                ]
            )

        OFFLINE_SYNC_STAGE_FAILURE_TOTAL.labels(
            stage=stage, reason=result.reason_code or "unknown"
        ).inc()
        self._log_stage_failure(
            anime=state.anime,
            stage=stage,
            reason_code=result.reason_code or "unknown",
            message=result.reason_message,
            quarantined=False,
        )
        return {
            "stage": stage,
            "status": result.status,
            "reason_code": result.reason_code or "unknown",
        }

    def _next_attempt_after_success(self, state: OfflineAnimeSyncState):
        next_stage = self._next_stage(state)
        if next_stage:
            return timezone.now()
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

    def _log_stage_failure(
        self,
        *,
        anime: Anime,
        stage: str,
        reason_code: str,
        message: str,
        quarantined: bool,
    ):
        request_fingerprint = (
            f"a:{anime.anilist_id or '-'}|m:{anime.mal_id or '-'}|t:{(anime.title or '')[:40].casefold()}"
        )
        logger.warning(
            "Offline sync stage failure",
            extra={
                "anime_id": anime.id,
                "stage": stage,
                "reason_code": reason_code,
                "quarantined": quarantined,
                "request_fingerprint": request_fingerprint,
                "error_message": (message or "")[:500],
            },
        )

    def _state_summary(self, *, anime_ids: list[int] | None = None) -> dict:
        queryset = OfflineAnimeSyncState.objects.filter(anime__offline_db_last_seen_at__isnull=False)
        if anime_ids:
            queryset = queryset.filter(anime_id__in=anime_ids)

        complete = queryset.filter(
            metadata_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            franchise_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            themes_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            quarantined=False,
        ).count()
        pending = queryset.filter(quarantined=False).exclude(
            metadata_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            franchise_status=OfflineAnimeSyncState.StageStatus.SYNCED,
            themes_status=OfflineAnimeSyncState.StageStatus.SYNCED,
        ).count()
        transient_backlog = queryset.filter(quarantined=False).filter(
            Q(metadata_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
            | Q(franchise_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
            | Q(themes_status=OfflineAnimeSyncState.StageStatus.TRANSIENT_ERROR)
        ).count()
        quarantined_count = queryset.filter(quarantined=True).count()
        top_reasons = list(
            queryset.filter(quarantined=True)
            .exclude(quarantine_reason="")
            .values("quarantine_reason")
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )

        return {
            "pending": pending,
            "complete": complete,
            "transient_backlog": transient_backlog,
            "quarantined_count": quarantined_count,
            "top_quarantine_reasons": top_reasons,
        }

    def reset_for_retry(self, state: OfflineAnimeSyncState):
        now = timezone.now()
        queryset = OfflineAnimeSyncState.objects.filter(id=state.id)
        queryset.update(
            metadata_status=(
                OfflineAnimeSyncState.StageStatus.PENDING
                if state.metadata_status != OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.SYNCED
            ),
            franchise_status=(
                OfflineAnimeSyncState.StageStatus.PENDING
                if state.franchise_status != OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.SYNCED
            ),
            themes_status=(
                OfflineAnimeSyncState.StageStatus.PENDING
                if state.themes_status != OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.SYNCED
            ),
            quarantined=False,
            quarantine_reason="",
            quarantine_context={},
            last_error_code="",
            last_error_message="",
            next_attempt_at=now,
        )

    def mark_skipped(self, state: OfflineAnimeSyncState, *, reason: str = "marked_skipped"):
        now = timezone.now() + timedelta(days=36500)
        queryset = OfflineAnimeSyncState.objects.filter(id=state.id)
        queryset.update(
            metadata_status=(
                state.metadata_status
                if state.metadata_status == OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.QUARANTINED
            ),
            franchise_status=(
                state.franchise_status
                if state.franchise_status == OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.QUARANTINED
            ),
            themes_status=(
                state.themes_status
                if state.themes_status == OfflineAnimeSyncState.StageStatus.SYNCED
                else OfflineAnimeSyncState.StageStatus.QUARANTINED
            ),
            quarantined=True,
            quarantine_reason=reason,
            quarantine_context={"manual": True, "action": "mark_skipped"},
            next_attempt_at=now,
        )
