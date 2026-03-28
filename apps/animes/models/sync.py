from django.db.models import (
    CASCADE,
    BooleanField,
    CharField,
    DateTimeField,
    Index,
    IntegerField,
    JSONField,
    Model,
    OneToOneField,
    TextField,
    URLField,
)
from django.db.models.enums import TextChoices
from django.utils import timezone

from apps.shared.models import TimestampMixin


class OfflineCatalogImport(TimestampMixin, Model):
    class Status(TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    source_name = CharField(max_length=100, default="anime-offline-database")
    release_tag = CharField(max_length=50, blank=True)
    asset_name = CharField(max_length=100, default="anime-offline-database.jsonl.zst")
    source_url = URLField(max_length=500, blank=True)
    status = CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    started_at = DateTimeField(null=True, blank=True)
    completed_at = DateTimeField(null=True, blank=True)
    last_processed_line = IntegerField(default=0)
    records_seen = IntegerField(default=0)
    records_created = IntegerField(default=0)
    records_updated = IntegerField(default=0)
    records_marked_stale = IntegerField(default=0)
    records_failed = IntegerField(default=0)
    summary = JSONField(default=dict, blank=True)
    error_message = TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["source_name", "-created_at"]),
            Index(fields=["status", "-created_at"]),
        ]

    def __str__(self):
        release = self.release_tag or "latest"
        return f"{self.source_name} import {release} ({self.status})"


class OfflineAnimeSyncState(TimestampMixin, Model):
    class StageStatus(TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        SYNCED = "synced", "Synced"
        TRANSIENT_ERROR = "transient_error", "Transient Error"
        BLOCKED_IDENTITY = "blocked_identity", "Blocked: Identity Conflict"
        BLOCKED_NO_IDS = "blocked_no_ids", "Blocked: Missing IDs"
        QUARANTINED = "quarantined", "Quarantined"

    anime = OneToOneField("anime.Anime", CASCADE, related_name="offline_sync_state")
    metadata_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )
    franchise_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )
    themes_status = CharField(
        max_length=30,
        choices=StageStatus.choices,
        default=StageStatus.PENDING,
        db_index=True,
    )

    metadata_attempt_count = IntegerField(default=0)
    franchise_attempt_count = IntegerField(default=0)
    themes_attempt_count = IntegerField(default=0)
    attempt_count = IntegerField(default=0)

    last_attempt_at = DateTimeField(null=True, blank=True, db_index=True)
    next_attempt_at = DateTimeField(default=timezone.now, db_index=True)
    last_error_code = CharField(max_length=64, blank=True)
    last_error_message = TextField(blank=True)

    quarantined = BooleanField(default=False, db_index=True)
    quarantine_reason = CharField(max_length=120, blank=True)
    quarantine_context = JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["next_attempt_at", "id"]
        indexes = [
            Index(fields=["quarantined", "next_attempt_at"], name="anime_sync_q_due_idx"),
            Index(fields=["metadata_status", "next_attempt_at"], name="anime_sync_meta_due_idx"),
            Index(fields=["franchise_status", "next_attempt_at"], name="anime_sync_fr_due_idx"),
            Index(fields=["themes_status", "next_attempt_at"], name="anime_sync_th_due_idx"),
        ]

    def __str__(self):
        return f"Offline sync state for anime #{self.anime_id}"
