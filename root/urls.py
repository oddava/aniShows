"""
URL configuration for root project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.core.views import MetricsView
from apps.users.share_preview import ProfileSharePreviewView

urlpatterns = [
    # API v1 - includes all domain app URLs
    path("api/v1/", include("apps.animes.urls")),
    path("api/v1/", include("apps.users.urls")),
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/forums/", include("apps.forums.urls")),
    path("api/v1/admin/", include("apps.admin_api.urls")),
    # Django admin
    path("django-admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("i18n/", include("django.conf.urls.i18n")),
    path("metrics", MetricsView.as_view(), name="metrics"),
    path("u/<str:username>", ProfileSharePreviewView.as_view(), name="profile_share_preview"),
    path("u/<str:username>/", ProfileSharePreviewView.as_view(), name="profile_share_preview_slash"),
    path(
        "u/<str:username>/<path:section>",
        ProfileSharePreviewView.as_view(),
        name="profile_share_preview_section",
    ),
    path(
        "u/<str:username>/<path:section>/",
        ProfileSharePreviewView.as_view(),
        name="profile_share_preview_section_slash",
    ),
]

# Serve media files in DEBUG mode (static files are served by whitenoise)
if settings.DEBUG:
    from debug_toolbar.toolbar import debug_toolbar_urls
    from drf_spectacular.views import (
        SpectacularAPIView,
        SpectacularRedocView,
        SpectacularSwaggerView,
    )

    urlpatterns += (
        static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) + debug_toolbar_urls()
    )
    # Swagger/OpenAPI documentation
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
        path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    ]
