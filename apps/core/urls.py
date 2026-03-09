"""
Core app URL configuration.
Infrastructure endpoints: health checks, admin dashboard, celery management.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from django.urls import path
from .views import health_check

urlpatterns = [
    # Health check
    path("health/", health_check, name="health_check"),
]
