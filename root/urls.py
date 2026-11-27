"""
URL configuration for root project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from apps.animes.page_head import AnimeShellView
from apps.core.views import MetricsView, seo
from apps.users.share_preview import ProfileShellView

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
    # Caddy sends these four to Django; the SPA serves every other page.
    path("robots.txt", seo.robots_txt, name="robots_txt"),
    path("sitemap.xml", seo.sitemap_index, name="sitemap_index"),
    path("sitemap-pages.xml", seo.sitemap_pages, name="sitemap_pages"),
    path("sitemap-anime-<int:number>.xml", seo.sitemap_anime, name="sitemap_anime"),
    # The app's dynamic pages: index.html with the page's own <head> (meta,
    # Open Graph, JSON-LD, LCP image preload). Caddy routes /anime/* and /u/*
    # here and falls back to the static index.html on a 5xx (apps/core/spa_shell.py).
    re_path(r"^anime/(?P<slug>[^/]+)(?:/.*)?$", AnimeShellView.as_view(), name="anime_shell"),
    re_path(
        r"^u/(?P<username>[^/]+)(?:/(?P<section>.*))?$",
        ProfileShellView.as_view(),
        name="profile_shell",
    ),
]

# Serve media files in DEBUG mode (static files are served by whitenoise)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

    if "debug_toolbar" in settings.INSTALLED_APPS:
        from debug_toolbar.toolbar import debug_toolbar_urls

        urlpatterns += debug_toolbar_urls()

    if "drf_spectacular" in settings.INSTALLED_APPS:
        from drf_spectacular.views import (
            SpectacularAPIView,
            SpectacularRedocView,
            SpectacularSwaggerView,
        )

        urlpatterns += [
            path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
            path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
            path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
        ]
