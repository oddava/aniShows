"""
Shared admin permissions and pagination for the aniShows admin dashboard.
"""

from rest_framework import permissions
from rest_framework.pagination import PageNumberPagination


class AdminPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class IsAdminUser(permissions.BasePermission):
    """Custom permission to only allow admin/staff users."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_staff or request.user.is_superuser)
        )
