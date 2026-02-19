"""
URL configuration for root project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

from apps.core.views import MetricsView

urlpatterns = [
    # API v1 - includes all domain app URLs
    path("api/v1/", include("apps.animes.urls")),
    path("api/v1/", include("apps.users.urls")),
    path("api/v1/", include("apps.core.urls")),
    # Django admin
    path("django-admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("i18n/", include("django.conf.urls.i18n")),
    path("metrics", MetricsView.as_view(), name="metrics"),
]

# Only serve media files if DEBUG is True
from django.views.static import serve
from django.urls import re_path

# Only serve media files if DEBUG is True
if settings.DEBUG:
    from debug_toolbar.toolbar import debug_toolbar_urls

    urlpatterns += (
        static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
        + debug_toolbar_urls()
    )
