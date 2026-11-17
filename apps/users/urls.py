"""
Users app URL configuration.

The routes live in ``apps/users/urlconf/``, one module per owning group
(accounts G1, lists and imports G3, notifications G4, social G5). This file only
composes them: priority paths first, then the shared router, then the rest.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .urlconf import accounts, imports, lists, notifications, social

_DOMAINS = (accounts, social, lists, notifications, imports)

router = DefaultRouter()
for _domain in _DOMAINS:
    for _prefix, _viewset, _basename in getattr(_domain, "router_routes", ()):
        router.register(_prefix, _viewset, basename=_basename)

urlpatterns = [
    *(p for d in _DOMAINS for p in getattr(d, "priority_urlpatterns", ())),
    path("", include(router.urls)),
    *(p for d in _DOMAINS for p in d.urlpatterns),
]
