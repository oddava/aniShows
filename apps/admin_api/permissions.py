"""One permission model for every ``/api/v1/admin/`` view (G6 P0-2).

Staff (moderators) read the admin and moderate: the dashboard, reports, catalog
lists, users and the audit log; resolve review reports, delete reviews, and
suspend or restore non-staff users. Everything else that writes, or exposes IPs,
user agents or task payloads, is superuser-only.

``ADMIN_ACTION_POLICY`` maps a view class name to ``{action: STAFF | SUPERUSER}``.
For a ViewSet the key is the DRF action (``list``, ``destroy``, ``suspend``); for a
plain ``APIView`` it is the lower-case HTTP method. Anything missing from the map,
a view or an action, is superuser-only: the policy fails closed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from rest_framework.permissions import BasePermission

if TYPE_CHECKING:
    from collections.abc import Sequence

    from rest_framework.permissions import _PermissionClass

STAFF: Final = "staff"
SUPERUSER: Final = "superuser"

_READ = {"list": STAFF, "retrieve": STAFF}
_CATALOG_WRITES = {
    "create": SUPERUSER,
    "update": SUPERUSER,
    "partial_update": SUPERUSER,
    "destroy": SUPERUSER,
}

ADMIN_ACTION_POLICY: Final[dict[str, dict[str, str]]] = {
    # Users and badges
    "AdminUserViewSet": {
        **_READ,
        "suspend": STAFF,
        "restore": STAFF,
        "revoke_sessions": STAFF,
        "send_password_reset": STAFF,
        "clear_profile": STAFF,
        "verify_email": SUPERUSER,
        "toggle_staff": SUPERUSER,
        "export": SUPERUSER,
        "destroy": SUPERUSER,
    },
    "AdminBadgeViewSet": {
        **_READ,
        "holders": STAFF,
        **_CATALOG_WRITES,
        "grant": SUPERUSER,
        "revoke": SUPERUSER,
    },
    # Moderation
    "AdminReviewViewSet": {
        **_READ,
        "destroy": STAFF,
        "toggle_spoiler": STAFF,
        "reports": STAFF,
        "resolve_reports": STAFF,
    },
    "AdminModerationReviewViewSet": {"list": STAFF, "resolve": STAFF},
    "AdminModerationForumViewSet": {"list": STAFF, "resolve": STAFF},
    "AdminModerationSummaryView": {"get": STAFF},
    # Forums: staff moderate threads and posts; superusers shape categories and tags
    "AdminForumCategoryViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminForumTagViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminForumThreadViewSet": {
        **_READ,
        "pin": STAFF,
        "lock": STAFF,
        "remove": STAFF,
        "restore": STAFF,
        "move": STAFF,
        "destroy": SUPERUSER,
    },
    "AdminForumPostViewSet": {**_READ, "remove": STAFF, "restore": STAFF},
    # Catalog
    "AdminAnimeViewSet": {
        **_READ,
        # PUT is routed but refused (405): only PATCH of the SEO text is allowed.
        "update": SUPERUSER,
        "partial_update": SUPERUSER,
        "refresh": SUPERUSER,
        "refetch_images": SUPERUSER,
        "destroy": SUPERUSER,
    },
    "AdminGenreViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminStudioViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminCharacterViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminStaffViewSet": {**_READ, **_CATALOG_WRITES},
    "AdminFavoritesStatsViewSet": {"stats": STAFF},
    "AdminUserImportViewSet": dict(_READ),
    # Catalog engine: anyone on staff reads it; running a lane spends AniList budget
    "AdminCatalogView": {"get": STAFF},
    "AdminCatalogRunViewSet": {"list": STAFF},
    "AdminCatalogLaneRunView": {"post": SUPERUSER},
    # Logs: system logs carry IPs and user agents
    "AdminSystemLogViewSet": {"list": SUPERUSER, "retrieve": SUPERUSER, "stats": SUPERUSER},
    "AdminAuditLogViewSet": {**_READ, "entity_types": STAFF},
    # Overview
    "AdminDashboardView": {"get": STAFF},
    "AdminStatsExportView": {"get": STAFF},
    "AdminReportsView": {"get": STAFF},
    "AdminBulkOperationsView": {"post": SUPERUSER},
    "AdminSettingsView": {"get": STAFF, "put": SUPERUSER},
    "AdminSearchView": {"get": STAFF},
    "AdminAnnouncementViewSet": {**_READ, **_CATALOG_WRITES, "notify": SUPERUSER},
    # System and Celery drill-down (task results hold task payloads)
    "AdminSystemView": {"get": STAFF},
    "AdminSystemBeatRunView": {"post": SUPERUSER},
    "CeleryTaskResultViewSet": {
        "list": SUPERUSER,
        "retrieve": SUPERUSER,
        "destroy": SUPERUSER,
        "bulk_delete": SUPERUSER,
    },
    "CeleryAdminControlViewSet": {"trigger_task": SUPERUSER, "control_task": SUPERUSER},
}


def view_action(view, request) -> str:
    """The policy key for this request: the ViewSet action, else the HTTP method."""
    action = getattr(view, "action", None)
    if action:
        return action
    return (request.method or "").lower()


def required_level(view, request) -> str:
    """``STAFF`` or ``SUPERUSER``; anything not listed is ``SUPERUSER``."""
    return ADMIN_ACTION_POLICY.get(type(view).__name__, {}).get(
        view_action(view, request), SUPERUSER
    )


def is_staff_user(user) -> bool:
    return bool(
        user and user.is_authenticated and user.is_active and (user.is_staff or user.is_superuser)
    )


class AdminActionPermission(BasePermission):
    """Staff for the actions the policy grants them, superuser for everything else."""

    def has_permission(self, request, view):
        user = request.user
        if not is_staff_user(user):
            return False
        if required_level(view, request) == STAFF:
            return True
        return bool(user.is_superuser)


class AdminPolicyMixin:
    """Gate a view by ``ADMIN_ACTION_POLICY``. Admin views inherit this, nothing else."""

    permission_classes: Sequence[_PermissionClass] = (AdminActionPermission,)


def is_superuser_request(request) -> bool:
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and user.is_superuser)
