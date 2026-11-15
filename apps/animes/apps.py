from django.apps import AppConfig


class AnimeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.animes"
    label = "anime"

    def ready(self):
        from . import lookups, signals  # noqa: F401 - register the lookup and signal handlers
