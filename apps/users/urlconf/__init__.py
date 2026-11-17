"""Users app routes, one module per owning group; composed by ``apps/users/urls.py``.

Each module may define:

- ``router_routes``: ``(prefix, viewset, basename)`` tuples for the shared DefaultRouter;
- ``priority_urlpatterns``: paths matched before the router (they share its prefixes,
  e.g. ``users/me/`` must win over the ``users`` viewset's detail route);
- ``urlpatterns``: everything else, matched after the router.

Route names are part of the API contract (``reverse()`` in tests and services): keep them.
"""
