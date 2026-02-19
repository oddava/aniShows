from django.apps import AppConfig


class AnimeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.animes"
    label = "anime"

    def ready(self):
        import apps.animes.signals
