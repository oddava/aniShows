"""
Core app URL configuration.
Infrastructure endpoints: health checks, admin dashboard, celery management.
"""

from django.urls import path

from .views import health_check, readiness_check
from .views.announcements import ActiveAnnouncementsView

urlpatterns = [
    path("announcements/active/", ActiveAnnouncementsView.as_view(), name="announcements_active"),
    path("health/", health_check, name="health_check"),
    path("health/ready/", readiness_check, name="readiness_check"),
]
