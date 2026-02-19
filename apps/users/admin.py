from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.html import format_html
from django.db.models import Count

from apps.users.models import CustomUser, UserProfile, UserImportJob


class UserProfileInline(admin.StackedInline):
    """Inline admin for user profiles."""

    model = UserProfile
    can_delete = False
    verbose_name_plural = "Profile"
    fields = [
        "avatar",
        "banner",
        "bio",
        "is_private",
        "email_verified",
        "points",
        "last_activity",
    ]
    readonly_fields = ["last_activity"]


class UserImportJobInline(admin.TabularInline):
    """Inline admin for user import jobs."""

    model = UserImportJob
    extra = 0
    can_delete = False
    fields = [
        "source",
        "status",
        "progress_percentage",
        "created_at",
    ]
    readonly_fields = [
        "source",
        "status",
        "progress_percentage",
        "created_at",
    ]
    ordering = ["-created_at"]


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    """Custom admin for user management."""

    list_display = [
        "username",
        "email",
        "is_active",
        "is_staff",
        "is_superuser",
        "date_joined",
        "last_login",
        "activity_summary",
    ]

    list_filter = [
        "is_active",
        "is_staff",
        "is_superuser",
        ("date_joined", admin.DateFieldListFilter),
        ("last_login", admin.DateFieldListFilter),
    ]

    search_fields = [
        "username",
        "email",
        "first_name",
        "last_name",
    ]

    ordering = ["-date_joined"]

    date_hierarchy = "date_joined"

    fieldsets = (
        ("Basic Information", {"fields": ("username", "email", "password")}),
        ("Personal Info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (
            "Important Dates",
            {"fields": ("last_login", "date_joined"), "classes": ("collapse",)},
        ),
    )

    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "email", "password1", "password2"),
            },
        ),
    )

    readonly_fields = ["last_login", "date_joined"]

    inlines = [UserProfileInline, UserImportJobInline]

    actions = [
        "activate_users",
        "deactivate_users",
        "make_staff",
        "remove_staff",
        "delete_unverified",
    ]

    def activity_summary(self, obj):
        """Display user activity summary."""
        stats = []
        if hasattr(obj, "favorites"):
            stats.append(f"Fav: {obj.favorites.count()}")
        if hasattr(obj, "reviews"):
            stats.append(f"Rev: {obj.reviews.count()}")
        if hasattr(obj, "anime_lists"):
            stats.append(f"List: {obj.anime_lists.count()}")
        return format_html("<br>".join(stats)) if stats else "-"

    activity_summary.short_description = "Activity"

    @admin.action(description="Activate selected users")
    def activate_users(self, request, queryset):
        """Bulk activate users."""
        count = queryset.update(is_active=True)
        self.message_user(request, f"{count} user(s) activated successfully.")

    @admin.action(description="Deactivate selected users")
    def deactivate_users(self, request, queryset):
        """Bulk deactivate users."""
        # Prevent deactivating yourself
        queryset = queryset.exclude(id=request.user.id)
        # Prevent deactivating superusers (unless you're superuser)
        if not request.user.is_superuser:
            queryset = queryset.filter(is_superuser=False)

        count = queryset.update(is_active=False)
        self.message_user(request, f"{count} user(s) deactivated successfully.")

    @admin.action(description="Promote to staff")
    def make_staff(self, request, queryset):
        """Promote users to staff."""
        if not request.user.is_superuser:
            self.message_user(
                request, "Only superusers can promote to staff.", level="error"
            )
            return

        count = queryset.update(is_staff=True)
        self.message_user(request, f"{count} user(s) promoted to staff.")

    @admin.action(description="Remove staff status")
    def remove_staff(self, request, queryset):
        """Remove staff status from apps.users."""
        if not request.user.is_superuser:
            self.message_user(
                request, "Only superusers can remove staff status.", level="error"
            )
            return

        # Prevent removing your own staff status
        queryset = queryset.exclude(id=request.user.id)
        count = queryset.update(is_staff=False)
        self.message_user(request, f"{count} user(s) removed from staff.")

    @admin.action(description="Delete unverified accounts older than 7 days")
    def delete_unverified(self, request, queryset):
        """Delete unverified accounts."""
        from django.utils import timezone
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=7)

        # Find unverified users
        unverified = queryset.filter(
            userprofile__email_verified=False,
            date_joined__lt=cutoff_date,
            is_superuser=False,  # Never delete superusers
        )

        count = unverified.count()
        unverified.delete()
        self.message_user(request, f"{count} unverified account(s) deleted.")

    def get_queryset(self, request):
        """Add annotations for performance."""
        queryset = super().get_queryset(request)
        return queryset.select_related("userprofile").prefetch_related(
            "favorites", "reviews", "anime_lists"
        )


@admin.register(UserImportJob)
class UserImportJobAdmin(admin.ModelAdmin):
    """Admin for user import jobs."""

    list_display = [
        "id",
        "user",
        "source",
        "source_identifier_short",
        "status_badge",
        "progress_bar",
        "created_at",
        "duration_display",
    ]

    list_filter = [
        "source",
        "status",
        ("created_at", admin.DateFieldListFilter),
    ]

    search_fields = [
        "user__username",
        "user__email",
        "source_identifier",
    ]

    readonly_fields = [
        "user",
        "source",
        "source_identifier",
        "status",
        "total_entries",
        "processed_entries",
        "imported_entries",
        "skipped_entries",
        "failed_entries",
        "fetched_entries",
        "progress_percentage",
        "errors",
        "created_at",
        "started_at",
        "completed_at",
    ]

    date_hierarchy = "created_at"
    ordering = ["-created_at"]

    fieldsets = (
        (
            "Job Information",
            {"fields": ("user", "source", "source_identifier", "status")},
        ),
        (
            "Progress",
            {
                "fields": (
                    "total_entries",
                    "processed_entries",
                    "imported_entries",
                    "skipped_entries",
                    "failed_entries",
                    "fetched_entries",
                    "progress_percentage",
                )
            },
        ),
        ("Errors", {"fields": ("errors",), "classes": ("collapse",)}),
        (
            "Timestamps",
            {
                "fields": ("created_at", "started_at", "completed_at"),
                "classes": ("collapse",),
            },
        ),
    )

    actions = ["retry_jobs", "cancel_jobs", "delete_old_jobs"]

    def source_identifier_short(self, obj):
        """Display shortened source identifier."""
        if len(obj.source_identifier) > 30:
            return format_html(
                '<span title="{}">{}...</span>',
                obj.source_identifier,
                obj.source_identifier[:27],
            )
        return obj.source_identifier

    source_identifier_short.short_description = "Source ID"

    def status_badge(self, obj):
        """Display status with color-coded badge."""
        colors = {
            "pending": "secondary",
            "processing": "primary",
            "completed": "success",
            "failed": "danger",
            "cancelled": "warning",
        }
        color = colors.get(obj.status, "secondary")
        return format_html(
            '<span class="badge badge-{}">{}</span>', color, obj.get_status_display()
        )

    status_badge.short_description = "Status"

    def progress_bar(self, obj):
        """Display progress as a visual bar."""
        if obj.total_entries > 0:
            percentage = obj.progress_percentage
            return format_html(
                '<div class="progress" style="height: 20px;">'
                '<div class="progress-bar" role="progressbar" style="width: {}%" '
                'aria-valuenow="{}" aria-valuemin="0" aria-valuemax="100">{}%</div></div>',
                percentage,
                percentage,
                percentage,
            )
        return "-"

    progress_bar.short_description = "Progress"

    def duration_display(self, obj):
        """Display job duration."""
        if obj.started_at and obj.completed_at:
            duration = obj.completed_at - obj.started_at
            minutes = int(duration.total_seconds() / 60)
            seconds = int(duration.total_seconds() % 60)
            return f"{minutes}m {seconds}s"
        elif obj.started_at:
            return "Running..."
        return "-"

    duration_display.short_description = "Duration"

    @admin.action(description="Retry selected failed jobs")
    def retry_jobs(self, request, queryset):
        """Retry failed import jobs."""
        from apps.users.tasks import process_import_job

        retried = 0
        for job in queryset.filter(status="failed"):
            try:
                job.status = "pending"
                job.errors = []
                job.save()

                # Trigger the task
                process_import_job.delay(job.id)
                retried += 1
            except Exception as e:
                self.message_user(
                    request, f"Failed to retry job {job.id}: {e}", level="error"
                )

        if retried > 0:
            self.message_user(request, f"{retried} job(s) queued for retry.")

    @admin.action(description="Cancel selected pending jobs")
    def cancel_jobs(self, request, queryset):
        """Cancel pending import jobs."""
        cancelled = queryset.filter(status__in=["pending", "processing"]).update(
            status="failed"
        )
        self.message_user(request, f"{cancelled} job(s) cancelled.")

    @admin.action(description="Delete jobs older than 30 days")
    def delete_old_jobs(self, request, queryset):
        """Delete old import jobs."""
        from django.utils import timezone
        from datetime import timedelta

        cutoff_date = timezone.now() - timedelta(days=30)
        old_jobs = UserImportJob.objects.filter(created_at__lt=cutoff_date)
        count = old_jobs.count()
        old_jobs.delete()
        self.message_user(request, f"{count} old job(s) deleted.")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
