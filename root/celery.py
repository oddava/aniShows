import os
from celery import Celery
from django.conf import settings

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "root.settings")

app = Celery("root")

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

# Debug task - only available in DEBUG mode
if os.getenv("DEBUG", "False") == "True":

    @app.task(bind=True, ignore_result=True)
    def debug_task(self):
        print(f"Request: {self.request!r}")


# Queue Configuration
app.conf.task_routes = {
    "anime.tasks.fetch_deep_metadata": {"queue": "low_priority"},
    "anime.tasks.import_anime_task": {"queue": "low_priority"},
    "anime.tasks.sync_trending_anime": {"queue": "default"},
    "anime.tasks.sync_seasonal_anime": {"queue": "default"},
    "anime.tasks.sync_next_season_anime": {"queue": "default"},
    "anime.tasks.sync_airing_anime": {"queue": "default"},  # Critical for schedule
    "anime.tasks.cleanup_finished_airing_dates": {"queue": "low_priority"},
    "anime.tasks.backfill_airing_dates": {"queue": "low_priority"},
    "anime.tasks.generate_user_recommendations": {
        "queue": "low_priority"
    },  # Can run on low priority queue
    "anime.tasks.generate_recommendations_for_user": {
        "queue": "default"
    },  # User-initiated needs faster response
    # Import/Export tasks
    "users.tasks.process_import_job": {"queue": "default"},
    "users.tasks.fetch_anime_by_external_id": {"queue": "low_priority"},
    "users.tasks.cleanup_old_import_jobs": {"queue": "low_priority"},
    # Image processing tasks
    "anime.tasks.generate_image_thumbnails": {"queue": "low_priority"},
}

# Ensure queues are defined
from kombu import Queue

app.conf.task_queues = (
    Queue("default", routing_key="default"),
    Queue("low_priority", routing_key="low_priority"),
)

# Set default queue for tasks without explicit routing
app.conf.task_default_queue = "default"
app.conf.task_default_exchange = "default"
app.conf.task_default_routing_key = "default"
