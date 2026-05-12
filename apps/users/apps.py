from importlib import import_module

from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.users"
    label = "users"

    def ready(self):
        import_module("apps.users.services.email_service")
        import_module("apps.users.signals")
