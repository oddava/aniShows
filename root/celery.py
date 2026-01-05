import os
from celery import Celery
from django.conf import settings

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'root.settings')

app = Celery('root')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

# Debug task - only available in DEBUG mode
if os.getenv('DEBUG', 'False') == 'True':
    @app.task(bind=True, ignore_result=True)
    def debug_task(self):
        print(f'Request: {self.request!r}')

# Queue Configuration
app.conf.task_routes = {
    'anime.tasks.fetch_deep_metadata': {'queue': 'low_priority'},
    'anime.tasks.import_anime_task': {'queue': 'low_priority'},
    'anime.tasks.sync_trending_anime': {'queue': 'default'},
    'anime.tasks.sync_seasonal_anime': {'queue': 'default'},
}

# Optional: Ensure queues are defined (Celery does this auto-magically usually, but explicit is good)
from kombu import Queue
app.conf.task_queues = (
    Queue('default', routing_key='default'),
    Queue('low_priority', routing_key='low_priority'),
)
