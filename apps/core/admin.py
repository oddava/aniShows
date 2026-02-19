from django.contrib import admin
from django.utils.html import format_html

# Import celery admin to register models (registers automatically via @admin.register)
from apps.core import celery_admin  # noqa: F401

from apps.core.models import SystemLog, AuditLog

# Admin site branding
admin.site.site_header = "aniShows Administration"
admin.site.site_title = "aniShows Admin Portal"
admin.site.index_title = "Welcome to aniShows Admin"


@admin.register(SystemLog)
class SystemLogAdmin(admin.ModelAdmin):
    """Admin for system logs."""

    list_display = [
        "timestamp",
        "level_badge",
        "log_type",
        "message_short",
        "user_link",
        "path",
        "status_code",
    ]

    list_filter = [
        "level",
        "log_type",
        ("timestamp", admin.DateFieldListFilter),
    ]

    search_fields = [
        "message",
        "details",
        "path",
        "user__username",
    ]

    date_hierarchy = "timestamp"
    ordering = ["-timestamp"]

    readonly_fields = [
        "timestamp",
        "level",
        "log_type",
        "user",
        "user_ip",
        "method",
        "path",
        "status_code",
        "message",
        "details_formatted",
        "duration_ms",
    ]

    fieldsets = (
        ("Log Information", {"fields": ("timestamp", "level", "log_type")}),
        ("User Information", {"fields": ("user", "user_ip")}),
        (
            "Request Details",
            {"fields": ("method", "path", "status_code", "duration_ms")},
        ),
        ("Content", {"fields": ("message", "details_formatted")}),
    )

    actions = ["clear_old_logs"]

    def level_badge(self, obj):
        """Display level with color-coded badge."""
        colors = {
            "DEBUG": "secondary",
            "INFO": "info",
            "WARNING": "warning",
            "ERROR": "danger",
            "CRITICAL": "dark",
        }
        color = colors.get(obj.level, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_level_display()
        )

    level_badge.short_description = "Level"

    def message_short(self, obj):
        """Display shortened message."""
        if len(obj.message) > 80:
            return format_html(
                '<span title="{}">{}...</span>', obj.message, obj.message[:77]
            )
        return obj.message

    message_short.short_description = "Message"

    def user_link(self, obj):
        """Display user as link."""
        if obj.user:
            return format_html(
                '<a href="/admin/users/customuser/{}/change/">{}</a>',
                obj.user.id,
                obj.user.username,
            )
        return "-"

    user_link.short_description = "User"

    def details_formatted(self, obj):
        """Display formatted details."""
        if obj.details:
            import json

            formatted = json.dumps(obj.details, indent=2)
            return format_html("<pre>{}</pre>", formatted)
        return "-"

    details_formatted.short_description = "Details"

    @admin.action(description="Clear logs older than 30 days")
    def clear_old_logs(self, request, queryset):
        """Clear old system logs."""
        from django.utils import timezone
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=30)
        old_logs = SystemLog.objects.filter(timestamp__lt=cutoff_date)
        count = old_logs.count()
        old_logs.delete()
        self.message_user(request, f"Cleared {count} old system log entries.")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Admin for audit logs."""

    list_display = [
        "timestamp",
        "action_badge",
        "user_link",
        "entity_type",
        "entity_repr_short",
        "changes_summary",
    ]

    list_filter = [
        "action",
        "entity_type",
        ("timestamp", admin.DateFieldListFilter),
    ]

    search_fields = [
        "entity_repr",
        "entity_type",
        "user__username",
        "changes",
    ]

    date_hierarchy = "timestamp"
    ordering = ["-timestamp"]

    readonly_fields = [
        "timestamp",
        "user",
        "user_ip",
        "action",
        "entity_type",
        "entity_id",
        "entity_repr",
        "previous_state_formatted",
        "new_state_formatted",
        "changes_formatted",
        "metadata_formatted",
    ]

    fieldsets = (
        ("Action Information", {"fields": ("timestamp", "action", "user", "user_ip")}),
        ("Entity Details", {"fields": ("entity_type", "entity_id", "entity_repr")}),
        (
            "Changes",
            {
                "fields": (
                    "previous_state_formatted",
                    "new_state_formatted",
                    "changes_formatted",
                )
            },
        ),
        ("Metadata", {"fields": ("metadata_formatted",), "classes": ("collapse",)}),
    )

    actions = ["clear_old_logs"]

    def action_badge(self, obj):
        """Display action with color-coded badge."""
        colors = {
            "CREATE": "success",
            "UPDATE": "warning",
            "DELETE": "danger",
            "LOGIN": "info",
            "LOGOUT": "secondary",
            "EXPORT": "primary",
            "BULK_ACTION": "dark",
        }
        color = colors.get(obj.action, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_action_display()
        )

    action_badge.short_description = "Action"

    def user_link(self, obj):
        """Display user as link."""
        if obj.user:
            return format_html(
                '<a href="/admin/users/customuser/{}/change/">{}</a>',
                obj.user.id,
                obj.user.username,
            )
        return "System"

    user_link.short_description = "User"

    def entity_repr_short(self, obj):
        """Display shortened entity representation."""
        if len(obj.entity_repr) > 40:
            return format_html(
                '<span title="{}">{}...</span>', obj.entity_repr, obj.entity_repr[:37]
            )
        return obj.entity_repr

    entity_repr_short.short_description = "Entity"

    def changes_summary(self, obj):
        """Display summary of changes."""
        if obj.changes:
            count = len(obj.changes)
            return format_html(
                '<span class="badge badge-info">{} field(s) changed</span>', count
            )
        return "-"

    changes_summary.short_description = "Changes"

    def _format_json_field(self, data):
        """Helper to format JSON fields."""
        if data:
            import json

            formatted = json.dumps(data, indent=2)
            return format_html(
                '<pre style="max-height: 300px; overflow: auto;">{}</pre>', formatted
            )
        return "-"

    def previous_state_formatted(self, obj):
        return self._format_json_field(obj.previous_state)

    previous_state_formatted.short_description = "Previous State"

    def new_state_formatted(self, obj):
        return self._format_json_field(obj.new_state)

    new_state_formatted.short_description = "New State"

    def changes_formatted(self, obj):
        return self._format_json_field(obj.changes)

    changes_formatted.short_description = "Changes"

    def metadata_formatted(self, obj):
        return self._format_json_field(obj.metadata)

    metadata_formatted.short_description = "Metadata"

    @admin.action(description="Clear audit logs older than 180 days")
    def clear_old_logs(self, request, queryset):
        """Clear old audit logs."""
        from django.utils import timezone
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=180)
        old_logs = AuditLog.objects.filter(timestamp__lt=cutoff_date)
        count = old_logs.count()
        old_logs.delete()
        self.message_user(request, f"Cleared {count} old audit log entries.")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
