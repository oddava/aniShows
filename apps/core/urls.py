"""
Core app URL configuration.
Infrastructure endpoints: health checks, admin dashboard, celery management.
"""

from django.urls import path

from .views import health_check, readiness_check

urlpatterns = [
    path("health/", health_check, name="health_check"),
    path("health/ready/", readiness_check, name="readiness_check"),
]
