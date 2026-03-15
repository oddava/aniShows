"""
Enhanced Celery configuration with advanced task routing and monitoring.

Features:
- Multiple specialized queues for different task types
- Smart task routing based on workload characteristics
- Circuit breaker support for external API calls
- Task deduplication and locking
- Dead letter queue for failed tasks

Queue Strategy:
- critical: Time-critical tasks (payments, auth, user-facing)
- high_priority: Important tasks that affect user experience
- default: Standard tasks with normal priority
- batch: Large import/export operations
- images: Image processing and thumbnail generation
- notifications: Email/push notifications
- analytics: Statistics and reporting
- low_priority: Background maintenance and cleanup
- dead_letter: Failed tasks for manual review
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

# Import Celery signals for global task monitoring
try:
    import apps.core.celery_signals
except ImportError as e:
    import logging

    logging.getLogger(__name__).warning(f"Failed to import celery_signals: {e}")

# ============================================================================
# TASK ROUTING CONFIGURATION
# ============================================================================

# Unified task routing with specialized queues
app.conf.task_routes = {
    # =========================================================================
    # CRITICAL QUEUE - User-facing, time-sensitive
    # =========================================================================
    "apps.users.tasks.process_import_job": {"queue": "critical"},
    # =========================================================================
    # HIGH PRIORITY - Important for user experience
    # =========================================================================
    # Anime Catalog Sync Tasks
    "apps.animes.tasks.sync.sync_anime_catalog": {"queue": "high_priority"},
    # Airing Workflow - affects schedule display
    "apps.animes.tasks.airing.sync_airing_workflow": {"queue": "high_priority"},
    # Theme Song Sync - time-sensitive but can queue
    "apps.animes.tasks.themes.sync_theme_songs": {"queue": "high_priority"},
    # Franchise Sync - important for navigation
    "apps.animes.tasks.franchises.sync_franchises": {"queue": "high_priority"},
    # =========================================================================
    # DEFAULT QUEUE - Standard operations
    # =========================================================================
    # User Tasks
    "apps.users.tasks.cleanup_unverified_accounts": {"queue": "default"},
    "apps.users.tasks.fetch_anime_by_external_id": {"queue": "default"},
    "apps.users.tasks.cleanup_old_import_jobs": {"queue": "default"},
    "apps.users.tasks.run_user_maintenance_workflow": {"queue": "default"},
    # Core Tasks
    "apps.core.tasks.notifications.send_pending_notifications": {"queue": "default"},
    "apps.core.tasks.notifications.check_new_episodes": {"queue": "default"},
    # =========================================================================
    # BATCH QUEUE - Import/export operations
    # =========================================================================
    "apps.animes.tasks.metadata.enrich_metadata": {"queue": "batch"},
    # =========================================================================
    # IMAGES QUEUE - Image processing
    # =========================================================================
    "apps.animes.tasks.images.fetch_anime_images": {"queue": "images"},
    "apps.animes.tasks.images.generate_image_thumbnails": {"queue": "images"},
    # =========================================================================
    # NOTIFICATIONS QUEUE - Email/push
    # =========================================================================
    "apps.users.services.email_service.*": {"queue": "notifications"},
    # =========================================================================
    # ANALYTICS QUEUE - Statistics and reporting
    # =========================================================================
    "apps.animes.tasks.recommendations.generate_recommendations": {"queue": "analytics"},
    "apps.users.tasks.update_user_stats": {"queue": "analytics"},
    # =========================================================================
    # LOW PRIORITY - Background maintenance
    # =========================================================================
    # Metadata and maintenance
    "apps.animes.tasks.franchises.update_relation_slugs": {"queue": "low_priority"},
    # Cleanup tasks
    "apps.core.tasks.notifications.cleanup_old_notifications_task": {"queue": "low_priority"},
    "apps.core.tasks.cleanup_tasks.cleanup_old_task_results": {"queue": "low_priority"},
    "apps.animes.tasks.themes.backfill_theme_youtube_urls": {"queue": "low_priority"},
    "apps.animes.tasks.images.heal_missing_anime_media": {"queue": "low_priority"},
    # User maintenance
    "apps.users.tasks.warm_profile_cache": {"queue": "low_priority"},
    "apps.users.tasks.update_all_user_stats": {"queue": "low_priority"},
}

# Define all queues
app.conf.task_queues = (
    Queue("critical", routing_key="critical"),
    Queue("high_priority", routing_key="high_priority"),
    Queue("default", routing_key="default"),
    Queue("batch", routing_key="batch"),
    Queue("images", routing_key="images"),
    Queue("notifications", routing_key="notifications"),
    Queue("analytics", routing_key="analytics"),
    Queue("low_priority", routing_key="low_priority"),
    Queue("dead_letter", routing_key="dead_letter"),
)

# Default queue settings
app.conf.task_default_queue = "default"
app.conf.task_default_exchange = "tasks"
app.conf.task_default_routing_key = "default"

# ============================================================================
# TASK EXECUTION SETTINGS
# ============================================================================

# Task acknowledgment - acknowledge after completion for better reliability
app.conf.task_acks_late = True

# Worker prefetch multiplier - 1 for fairness across workers
app.conf.worker_prefetch_multiplier = 1

# Task result expiration (1 day)
app.conf.result_expires = 86400

# Disable rate limits by default (enable per-task if needed)
app.conf.worker_disable_rate_limits = False  # Enable for better control

# Task execution timeout settings
# Short default — long-running tasks (sync, import, metadata) declare their own limits
app.conf.task_time_limit = 600  # 10 minutes hard limit (default)
app.conf.task_soft_time_limit = 540  # 9 minutes soft limit (default)

# Worker settings
app.conf.worker_max_tasks_per_child = 1000  # Restart worker after 1000 tasks
app.conf.worker_max_memory_per_child = 200000  # 200MB memory limit per worker

# ============================================================================
# RETRY AND ERROR HANDLING
# ============================================================================

# Dead letter queue configuration
app.conf.task_reject_on_worker_lost = True
app.conf.task_track_started = True

# ============================================================================
# MONITORING AND LOGGING
# ============================================================================

# Task events for monitoring (worker events only — sent events add overhead)
app.conf.task_send_sent_event = False
app.conf.worker_send_task_events = True

# ============================================================================
# CIRCUIT BREAKER SETTINGS
# ============================================================================

# External API circuit breaker configuration
app.conf.circuit_breaker_enabled = True
app.conf.circuit_breaker_failure_threshold = 5
app.conf.circuit_breaker_recovery_timeout = 60

# ============================================================================
# DEBUG TASK (Development Only)
# ============================================================================

if os.getenv("DEBUG", "False") == "True":

    @app.task(bind=True, ignore_result=True)
    def debug_task(self):
        print(f"Request: {self.request!r}")
