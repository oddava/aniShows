from rest_framework.permissions import BasePermission


class IsAdminUser(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.user.is_staff or request.user.is_superuser)
        )


class IsSuperUser(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_superuser
        )


class SuperUserRequiredForActionsMixin:
    superuser_actions = frozenset()

    def get_permissions(self):
        if getattr(self, "action", None) in self.superuser_actions:
            return [IsSuperUser()]
        return super().get_permissions()


class SuperUserRequiredForMethodsMixin:
    superuser_methods = frozenset()

    def get_permissions(self):
        if self.request.method.lower() in self.superuser_methods:
            return [IsSuperUser()]
        return super().get_permissions()
