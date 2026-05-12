from importlib import import_module

from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"

    def ready(self):
        import_module("apps.core.celery_signals")
        import_module("apps.core.tasks.logging_tasks")
