from django.apps import AppConfig


class ForumsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.forums"

    def ready(self):
        from . import signals  # noqa: F401 - registers the signal handlers
