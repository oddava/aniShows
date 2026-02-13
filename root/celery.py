"""
Updated Celery configuration with unified task routing.

Routes all tasks to appropriate queues:
- default: High priority, time-sensitive tasks
- low_priority: Background processing, can tolerate delays
"""

import os
from celery import Celery
from kombu import Queue

# Set the default Django settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings")

app = Celery("root")

# Configure from Django settings
app.config_from_object("django.conf:settings", namespace="CELERY")

# Auto-discover tasks from installed apps
app.autodiscover_tasks()

# ============================================================================
# TASK ROUTING CONFIGURATION
# ============================================================================

# Unified task routing
app.conf.task_routes = {
    # Anime Catalog Sync Tasks (High Priority)
    "anime.tasks.sync.sync_anime_catalog": {"queue": "default"},
    # Airing Workflow (High Priority - affects schedule display)
    "anime.tasks.airing.sync_airing_workflow": {"queue": "default"},
    # Metadata Enrichment (Low Priority - background processing)
    "anime.tasks.metadata.enrich_metadata": {"queue": "low_priority"},
    # Theme Song Sync (Default - time-sensitive but can queue)
    "anime.tasks.themes.sync_theme_songs": {"queue": "default"},
    # Recommendations (Low Priority - background processing)
    "anime.tasks.recommendations.generate_recommendations": {"queue": "low_priority"},
    # User Tasks
    "users.tasks.cleanup_unverified_accounts": {"queue": "low_priority"},
    "users.tasks.process_import_job": {"queue": "default"},
    "users.tasks.fetch_anime_by_external_id": {"queue": "low_priority"},
    "users.tasks.cleanup_old_import_jobs": {"queue": "low_priority"},
    "users.tasks.run_user_maintenance_workflow": {"queue": "low_priority"},
    # Legacy task routing (for backward compatibility)
    "anime.tasks.sync_trending_anime": {"queue": "default"},
    "anime.tasks.sync_seasonal_anime": {"queue": "default"},
    "anime.tasks.sync_next_season_anime": {"queue": "default"},
    "anime.tasks.sync_airing_anime": {"queue": "default"},
    "anime.tasks.cleanup_finished_airing_dates": {"queue": "low_priority"},
    "anime.tasks.backfill_airing_dates": {"queue": "low_priority"},
    "anime.tasks.backfill_metadata_task": {"queue": "low_priority"},
    "anime.tasks.fetch_deep_metadata": {"queue": "low_priority"},
    "anime.tasks.sync_themes_for_new_anime": {"queue": "default"},
    "anime.tasks.fetch_themes_for_anime": {"queue": "default"},
    "anime.tasks.generate_user_recommendations": {"queue": "low_priority"},
    "anime.tasks.generate_recommendations_for_user": {"queue": "default"},
    "anime.tasks.generate_image_thumbnails": {"queue": "low_priority"},
    "anime.tasks.backfill_catalog": {"queue": "low_priority"},
}

# Define queues
app.conf.task_queues = (
    Queue("default", routing_key="default"),
    Queue("low_priority", routing_key="low_priority"),
)

# Default queue settings
app.conf.task_default_queue = "default"
app.conf.task_default_exchange = "tasks"
app.conf.task_default_routing_key = "default"

# ============================================================================
# TASK EXECUTION SETTINGS
# ============================================================================

# Task acknowledgment
app.conf.task_acks_late = True

# Worker prefetch multiplier
app.conf.worker_prefetch_multiplier = 1

# Task result expiration (1 day)
app.conf.result_expires = 86400

# Disable rate limits by default (enable per-task if needed)
app.conf.worker_disable_rate_limits = True

# ============================================================================
# MONITORING AND LOGGING
# ============================================================================

# Task events for monitoring
app.conf.task_send_sent_event = True
app.conf.worker_send_task_events = True

# ============================================================================
# DEBUG TASK (Development Only)
# ============================================================================

if os.getenv("DEBUG", "False") == "True":

    @app.task(bind=True, ignore_result=True)
    def debug_task(self):
        print(f"Request: {self.request!r}")
