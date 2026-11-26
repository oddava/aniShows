"""Celery beat schedule (``CELERY_BEAT_SCHEDULE``), built by ``base.py``.

The few entries whose kwargs come from tuning settings take them as arguments,
so this module never imports the settings it is part of.

Entries are grouped by owning group, one function each (feature-revamp seams). A
group edits only its own function, plus the same keys in the ``CELERY_BEAT_SCHEDULE``
half of ``apps/core/tests/snapshots/beat_schedule_and_jazzmin.json``; the integrator
re-checks the snapshot at every merge. Keys must be unique across the functions
(``build_beat_schedule`` raises on a duplicate).
"""

from celery.schedules import crontab


def _catalog_lane(lane: str, schedule, queue: str, **kwargs) -> dict:
    return {
        "task": "apps.animes.tasks.catalog.run_catalog_lane",
        "schedule": schedule,
        "kwargs": {"lane": lane, **kwargs},
        "options": {"queue": queue},
    }


def _catalog_entries(*, media_self_heal_batch_size: int) -> dict:
    """Catalog engine lanes (apps.animes.catalog), then media and cache upkeep."""
    return {
        # Every title AniList changed: new announcements, dates, scores, new seasons.
        "catalog-delta-15min": _catalog_lane("delta", crontab(minute="7,22,37,52"), "default"),
        # Previous, current, next and following season in full: the Browse shelves.
        "catalog-seasons-6h": _catalog_lane("seasons", crontab(hour="*/6", minute=12), "default"),
        "catalog-trending-hourly": _catalog_lane("trending", crontab(minute=5), "high_priority"),
        # Next-episode times for the shows on air (50 shows per request).
        "catalog-airing-hourly": _catalog_lane("airing", crontab(minute=30), "high_priority"),
        # Cast, staff and images for what people open, then the most popular titles.
        "catalog-details-10min": _catalog_lane("hydrate", crontab(minute="*/10"), "low_priority"),
        # The full sweep: continues an unfinished one, and starts over weekly.
        "catalog-sweep-continue-hourly": _catalog_lane("seed", crontab(minute=40), "batch"),
        "catalog-sweep-weekly": _catalog_lane(
            "seed", crontab(day_of_week=2, hour=4, minute=10), "batch", restart=True
        ),
        "sync-watch-episodes-airing-every-6-hours": {
            "task": "apps.animes.tasks.watch_episodes.sync_watch_episodes_batch",
            "schedule": crontab(hour="*/6", minute=15),
            "kwargs": {"statuses": ["Airing", "Upcoming"], "force": True},
            "options": {"queue": "low_priority"},
        },
        # YouTube URL Backfill Task - Runs twice daily to catch missed themes
        "backfill-theme-youtube-urls-twice-daily": {
            "task": "apps.animes.tasks.themes.backfill_theme_youtube_urls",
            "schedule": crontab(hour="8,20", minute=30),  # 8:30 AM and 8:30 PM
            "kwargs": {"limit": 100},
            "options": {"queue": "low_priority"},
        },
        "heal-missing-media-30min": {
            "task": "apps.animes.tasks.images.heal_missing_anime_media",
            "schedule": crontab(minute="*/30"),
            "kwargs": {"batch_size": media_self_heal_batch_size},
            "options": {"queue": "low_priority"},
        },
        # Re-read AniList's isAdult for the whole catalog (adult_content.py).
        "sync-adult-flags-weekly": {
            "task": "apps.animes.tasks.adult_content.sync_adult_flags",
            "schedule": crontab(day_of_week=3, hour=3, minute=40),  # Wednesday 3:40 AM
            "options": {"queue": "low_priority"},
        },
        # Cache invalidations an outage kept (adult_content.py, PendingPublicCacheInvalidation).
        "replay-public-cache-invalidations": {
            "task": "apps.animes.tasks.adult_content.replay_public_cache_invalidations",
            "schedule": crontab(minute="*/5"),
            "options": {"queue": "default"},
        },
        "update-relation-slugs-daily": {
            "task": "apps.animes.tasks.franchises.update_relation_slugs",
            "schedule": crontab(hour=4, minute=30),  # Daily at 4:30 AM
            "kwargs": {"batch_size": 100},
            "options": {"queue": "low_priority"},
        },
    }


def _account_entries() -> dict:
    """G1 Accounts & auth.

    Empty: the hourly ``warm-profile-cache-hourly`` entry was retired (D-7, A21). Its
    payload differed from the live path and cost a 3-way join over all users each hour.
    Expired JWT rows are flushed from G3's ``user-maintenance-daily`` workflow instead.
    """
    return {}


def _recommendation_entries() -> dict:
    """G2 Browse & discover."""
    return {
        "generate-recommendations-daily": {
            "task": "apps.animes.tasks.recommendations.generate_recommendations",
            "schedule": crontab(hour=5, minute=0),  # 5:00 AM
            "kwargs": {"limit": 10},
            "options": {"queue": "low_priority"},
        },
    }


def _list_entries() -> dict:
    """G3 Lists & AniList sync."""
    return {
        "user-maintenance-daily": {
            "task": "apps.users.tasks.run_user_maintenance_workflow",
            "schedule": crontab(hour=7, minute=0),  # 7:00 AM
            "kwargs": {
                "cleanup_unverified": True,
                "cleanup_imports": True,
                "unverified_days": 7,
                "import_days": 30,
            },
            "options": {"queue": "low_priority"},
        },
        "update-user-stats-hourly": {
            "task": "apps.users.tasks.update_all_user_stats",
            "schedule": crontab(minute=10),  # Hourly backstop for missed incremental refreshes
            "options": {"queue": "low_priority"},
        },
    }


def _notification_entries() -> dict:
    """G4 Notifications."""
    return {
        "check-new-episodes": {
            "task": "apps.core.tasks.notifications.check_new_episodes",
            "schedule": crontab(minute=50),  # Hourly at :50 (D-7)
            "options": {"queue": "default"},
        },
        "send-pending-notifications": {
            "task": "apps.core.tasks.notifications.send_pending_notifications",
            "schedule": crontab(minute="*/10"),  # Every 10 minutes
            "options": {"queue": "default"},
        },
        "cleanup-old-notifications": {
            "task": "apps.core.tasks.notifications.cleanup_old_notifications_task",
            "schedule": crontab(hour=2, minute=30),  # Daily at 2:30 AM
            "kwargs": {"days": 90},
            "options": {"queue": "low_priority"},
        },
    }


def _maintenance_entries() -> dict:
    """G6 Admin: task results (+ log retention), worker health, forum view flush.

    ``collect-queue-metrics-minute`` was removed (D-7): the admin System page reads
    queue sizes from the broker on demand, and no Prometheus server scrapes them.
    """
    return {
        "cleanup-task-results-daily": {
            "task": "apps.core.tasks.cleanup_tasks.cleanup_old_task_results",
            "schedule": crontab(hour=1, minute=0),  # Daily at 1:00 AM
            "kwargs": {"days": 7, "batch_size": 1000},
            "options": {"queue": "low_priority"},
        },
        "health-check-workers-hourly": {
            "task": "apps.core.tasks.cleanup_tasks.health_check_workers",
            "schedule": crontab(minute=15),  # Every hour at 15 min past
            "options": {"queue": "low_priority"},
        },
        "flush-forum-view-counts-minute": {
            "task": "apps.core.tasks.cleanup_tasks.flush_forum_view_counts",
            "schedule": crontab(minute="*"),
            "options": {"queue": "low_priority"},
        },
    }


def build_beat_schedule(*, media_self_heal_batch_size: int) -> dict:
    parts = (
        _catalog_entries(media_self_heal_batch_size=media_self_heal_batch_size),
        _account_entries(),
        _recommendation_entries(),
        _list_entries(),
        _notification_entries(),
        _maintenance_entries(),
    )
    schedule: dict = {}
    for part in parts:
        duplicates = schedule.keys() & part.keys()
        if duplicates:
            raise ValueError(f"Duplicate beat entries: {sorted(duplicates)}")
        schedule.update(part)
    return schedule
