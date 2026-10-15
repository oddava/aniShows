"""
Settings entry point. Picks the module from DJANGO_ENV (read from the
environment or .env): "development", "testing" or "production".

Defaults to production so a missing variable never turns on DEBUG.

Only dispatches when DJANGO_SETTINGS_MODULE is "root.settings": importing a
specific module such as root.settings.test also runs this package __init__,
and must not load a second settings module.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

if os.environ.get("DJANGO_SETTINGS_MODULE", "root.settings") == "root.settings":
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

    env = os.getenv("DJANGO_ENV", "production").strip().lower()

    if env == "production":
        from .production import *
    elif env == "development":
        from .development import *
    elif env == "testing":
        from .test import *
    else:
        raise ImproperlyConfigured(
            f"Unknown DJANGO_ENV={env!r}; expected development, testing or production."
        )
