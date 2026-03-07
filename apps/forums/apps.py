from django.apps import AppConfig

class ForumsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.forums"

    def ready(self):
        import apps.forums.signals
