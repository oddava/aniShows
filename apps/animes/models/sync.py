from django.db.models import (
    CharField,
    DateTimeField,
    Index,
    IntegerField,
    JSONField,
    Model,
    PositiveIntegerField,
    TextField,
)
from django.db.models.enums import TextChoices
from django.utils import timezone


class CatalogRun(Model):
    """One run of one catalog lane (``apps.animes.catalog``): what it fetched and changed.

    The admin Catalog page lists these. A lane run that found nothing to do is still
    recorded, so the page can say "no changes since 14:15" instead of guessing.
    """

    class Lane(TextChoices):
        SEASONS = "seasons", "Seasons"
        DELTA = "delta", "Changes"
        TRENDING = "trending", "Trending"
        AIRING = "airing", "Airing"
        HYDRATE = "hydrate", "Details"
        SEED = "seed", "Full sweep"

    class Trigger(TextChoices):
        SCHEDULE = "schedule", "Schedule"
        ADMIN = "admin", "Admin"
        CHAIN = "chain", "Continued"

    class Status(TextChoices):
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        PARTIAL = "partial", "Stopped early"
        FAILED = "failed", "Failed"

    lane = CharField(max_length=16, choices=Lane.choices)
    trigger = CharField(max_length=16, choices=Trigger.choices, default=Trigger.SCHEDULE)
    status = CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    started_at = DateTimeField(default=timezone.now)
    finished_at = DateTimeField(null=True, blank=True)
    requests = PositiveIntegerField(default=0)
    fetched = PositiveIntegerField(default=0)
    created = PositiveIntegerField(default=0)
    updated = PositiveIntegerField(default=0)
    excluded = PositiveIntegerField(default=0)
    # Lane-specific facts: seasons counted, the sweep's position, the delta cursor.
    detail = JSONField(default=dict, blank=True)
    error = TextField(blank=True)
    triggered_by = IntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [
            Index(fields=["lane", "-started_at"], name="catalog_run_lane_idx"),
            Index(fields=["-started_at"], name="catalog_run_started_idx"),
        ]

    def __str__(self):
        return f"{self.lane} run #{self.pk} ({self.status})"

    @property
    def changed(self) -> int:
        return self.created + self.updated + self.excluded


class CatalogCursor(Model):
    """Where a lane left off: the sweep's year and page, the delta's ``updatedAt``."""

    lane = CharField(max_length=16, primary_key=True)
    state = JSONField(default=dict, blank=True)
    updated_at = DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.lane} cursor"


class PendingPublicCacheInvalidation(Model):
    """An anime whose cached public payloads could not be dropped (the cache was down).

    ``adult_content`` changes ``is_adult`` with ``update()`` and drops the cached
    lists and detail pages after the commit. When Redis is unreachable then, the
    slug is kept here, and ``replay_public_cache_invalidations`` (every 5 minutes)
    drops them once Redis is back: a title just flagged adult must not come back
    from a persisted cache entry, and re-running the sync would not help (the rows
    already carry the right flag, so nothing changes and nothing is invalidated).
    """

    slug = CharField(max_length=200, unique=True)
    created_at = DateTimeField(default=timezone.now)

    def __str__(self):
        return self.slug
