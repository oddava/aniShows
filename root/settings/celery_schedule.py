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


def _catalog_entries(
    *,
    offline_reconcile_batch_size: int,
    offline_reconcile_chunk_size: int,
    offline_reconcile_max_rounds: int,
    offline_reconcile_round_interval_minutes: int,
    media_self_heal_batch_size: int,
) -> dict:
    """Catalog ingestion: AniList sync, airing, metadata, media. FROZEN: integrator only."""
    return {
        "sync-trending-hourly": {
            "task": "apps.animes.tasks.sync.sync_anime_catalog",
            "schedule": crontab(minute=5),  # 5 min past hour
            "kwargs": {"sync_type": "trending", "limit": 50},
            "options": {"queue": "high_priority"},
        },
        "derive-airing-hourly": {
            "task": "apps.animes.tasks.sync.sync_anime_catalog",
            "schedule": crontab(minute=30),  # 30 min past hour
            "kwargs": {"sync_type": "airing", "limit": 500},
            "options": {"queue": "high_priority"},
        },
        "sync-airing-schedule-daily": {
            "task": "apps.animes.tasks.airing.sync_airing_workflow",
            "schedule": crontab(hour=1, minute=45),  # Daily before browse/schedule traffic ramps up
            "kwargs": {"phases": ["sync", "cleanup", "backfill"]},
            "options": {"queue": "high_priority"},
        },
        "sync-seasonal-daily": {
            "task": "apps.animes.tasks.sync.sync_anime_catalog",
            "schedule": crontab(hour=2, minute=0),  # 2:00 AM
            "kwargs": {"sync_type": "seasonal", "limit": 100},
            "options": {"queue": "default"},
        },
        "enrich-metadata-daily": {
            "task": "apps.animes.tasks.metadata.enrich_metadata",
            "schedule": crontab(hour=3, minute=0),  # 3:00 AM
            "kwargs": {"mode": "backfill", "batch_size": 100},
            "options": {"queue": "low_priority"},
        },
        "sync-watch-episodes-airing-every-6-hours": {
            "task": "apps.animes.tasks.watch_episodes.sync_watch_episodes_batch",
            "schedule": crontab(hour="*/6", minute=15),
            "kwargs": {"statuses": ["Airing", "Upcoming"], "force": True},
            "options": {"queue": "low_priority"},
        },
        "reconcile-offline-catalog-sync-hourly": {
            "task": "apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync",
            "schedule": crontab(minute=45),  # Hourly at :45
            "kwargs": {
                "anime_ids": [],
                "batch_size": offline_reconcile_batch_size,
                "chunk_size": offline_reconcile_chunk_size,
                "strict": False,
                "max_rounds": offline_reconcile_max_rounds,
                "round_interval_minutes": offline_reconcile_round_interval_minutes,
            },
            "options": {"queue": "batch"},
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
        "sync-upcoming-weekly": {
            "task": "apps.animes.tasks.sync.sync_anime_catalog",
            "schedule": crontab(day_of_week=0, hour=3, minute=30),  # Sunday 3:30 AM
            "kwargs": {"sync_type": "next_season", "limit": 100},
            "options": {"queue": "default"},
        },
        # Weekly: refresh a broader airing slice from local Anime fields
        "sync-popular-weekly": {
            "task": "apps.animes.tasks.sync.sync_anime_catalog",
            "schedule": crontab(day_of_week=1, hour=2, minute=0),  # Monday 2:00 AM
            "kwargs": {
                "sync_type": "airing",
                "limit": 500,
            },
            "options": {"queue": "low_priority"},
        },
        "reconcile-adult-flags-daily": {
            "task": "apps.animes.tasks.adult_content.reconcile_adult_flags",
            "schedule": crontab(hour=3, minute=40),  # Daily at 3:40 AM
            "options": {"queue": "low_priority"},
        },
        "update-relation-slugs-daily": {
            "task": "apps.animes.tasks.franchises.update_relation_slugs",
            "schedule": crontab(hour=4, minute=30),  # Daily at 4:30 AM
            "kwargs": {"batch_size": 100},
            "options": {"queue": "low_priority"},
        },
    }


def _account_entries() -> dict:
    """G1 Accounts & auth."""
    return {
        "warm-profile-cache-hourly": {
            "task": "apps.users.tasks.warm_profile_cache",
            "schedule": crontab(minute=0),  # Every hour
            "options": {"queue": "low_priority"},
        },
    }


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
            "schedule": crontab(hour="*/6", minute=0),  # Every 6 hours
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
    """G6 Admin: task results, worker health, queue metrics, forum view flush."""
    return {
        "collect-queue-metrics-minute": {
            "task": "apps.core.tasks.cleanup_tasks.collect_queue_metrics",
            "schedule": crontab(minute="*"),
            "options": {"queue": "low_priority"},
        },
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


def build_beat_schedule(
    *,
    offline_reconcile_batch_size: int,
    offline_reconcile_chunk_size: int,
    offline_reconcile_max_rounds: int,
    offline_reconcile_round_interval_minutes: int,
    media_self_heal_batch_size: int,
) -> dict:
    parts = (
        _catalog_entries(
            offline_reconcile_batch_size=offline_reconcile_batch_size,
            offline_reconcile_chunk_size=offline_reconcile_chunk_size,
            offline_reconcile_max_rounds=offline_reconcile_max_rounds,
            offline_reconcile_round_interval_minutes=offline_reconcile_round_interval_minutes,
            media_self_heal_batch_size=media_self_heal_batch_size,
        ),
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
