"""
Django settings for aniShows project.

This module loads the appropriate settings configuration based on the
DJANGO_ENV environment variable.

Available environments:
- development: Local development with DEBUG=True
- production: Production with security features enabled
- testing: Test environment (falls back to development)

Usage:
    Set DJANGO_ENV environment variable before starting Django:
    export DJANGO_ENV=production

    Or in .env file:
    DJANGO_ENV=development
"""

import os

# Determine which environment to load
env = os.getenv("DJANGO_ENV", "development")

if env == "production":
    from .production import *
elif env == "testing":
    from .test import *
else:
    from .development import *
