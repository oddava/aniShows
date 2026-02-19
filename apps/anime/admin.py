from django.contrib import admin
from django.utils.html import format_html
from django.db.models import Count

from .models import Anime, Genre, Studio, Review


@admin.register(Genre)
class GenreAdmin(admin.ModelAdmin):
    """Admin for anime genres."""

    list_display = ["name", "slug", "anime_count", "description_short"]
    prepopulated_fields = {"slug": ("name",)}
    search_fields = ["name", "description"]
    ordering = ["name"]

    fieldsets = (("Basic Information", {"fields": ("name", "slug", "description")}),)

    def anime_count(self, obj):
        """Count of anime in this genre."""
        return obj.anime_set.count()

    anime_count.short_description = "Anime Count"
    anime_count.admin_order_field = "anime_count"

    def description_short(self, obj):
        """Shortened description."""
        if obj.description:
            return (
                obj.description[:100] + "..."
                if len(obj.description) > 100
                else obj.description
            )
        return "-"

    description_short.short_description = "Description"

    def get_queryset(self, request):
        """Optimize queryset with annotation."""
        return super().get_queryset(request).annotate(anime_count=Count("anime"))


@admin.register(Studio)
class StudioAdmin(admin.ModelAdmin):
    """Admin for anime studios."""

    list_display = ["name", "founded_date", "anime_count", "website_link"]
    search_fields = ["name", "description"]
    ordering = ["name"]
    date_hierarchy = "founded_date"

    fieldsets = (
        ("Basic Information", {"fields": ("name", "description")}),
        ("Details", {"fields": ("founded_date", "website"), "classes": ("collapse",)}),
    )

    def anime_count(self, obj):
        """Count of anime by this studio."""
        return obj.anime_set.count()

    anime_count.short_description = "Anime Count"
    anime_count.admin_order_field = "anime_count"

    def website_link(self, obj):
        """Display website as clickable link."""
        if obj.website:
            return format_html(
                '<a href="{}" target="_blank">{}</a>', obj.website, obj.website[:30]
            )
        return "-"

    website_link.short_description = "Website"

    def get_queryset(self, request):
        """Optimize queryset with annotation."""
        return super().get_queryset(request).annotate(anime_count=Count("anime"))


class ReviewInline(admin.TabularInline):
    """Inline reviews for anime."""

    model = Review
    extra = 0
    fields = ["user", "rating", "text_short", "created_at"]
    readonly_fields = ["user", "rating", "text_short", "created_at"]
    can_delete = True
    ordering = ["-created_at"]

    def text_short(self, obj):
        """Shortened review text."""
        if obj.text:
            return obj.text[:100] + "..." if len(obj.text) > 100 else obj.text
        return "-"

    text_short.short_description = "Review"


@admin.register(Anime)
class AnimeAdmin(admin.ModelAdmin):
    """Admin for anime management with Celery task integration."""

    list_display = [
        "title",
        "cover_preview",
        "anime_type",
        "status_badge",
        "rating_display",
        "episode_count",
        "release_date",
        "favorites_count",
        "reviews_count",
    ]

    list_filter = [
        "status",
        "anime_type",
        "genres",
        ("release_date", admin.DateFieldListFilter),
        ("created_at", admin.DateFieldListFilter),
    ]

    search_fields = [
        "title",
        "title_jp",
        "synopsis",
        "studio__name",
    ]

    prepopulated_fields = {"slug": ("title",)}

    filter_horizontal = ["genres"]

    autocomplete_fields = ["studio"]

    date_hierarchy = "release_date"

    ordering = ["-created_at"]

    readonly_fields = [
        "created_at",
        "updated_at",
        "average_rating",
        "total_reviews",
        "total_favorites",
    ]

    fieldsets = (
        ("Basic Information", {"fields": ("title", "title_jp", "slug", "synopsis")}),
        ("Classification", {"fields": ("anime_type", "status", "genres", "studio")}),
        (
            "Episodes & Duration",
            {
                "fields": (
                    "episode_count",
                    "duration_minutes",
                    "release_date",
                    "end_date",
                )
            },
        ),
        ("Media", {"fields": ("cover_image", "banner_image", "trailer_url")}),
        (
            "Ratings & Statistics",
            {
                "fields": (
                    "rating",
                    ("average_rating", "total_reviews", "total_favorites"),
                ),
                "classes": ("collapse",),
            },
        ),
        ("SEO", {"fields": ("meta_description",), "classes": ("collapse",)}),
        (
            "Metadata",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )

    inlines = [ReviewInline]

    actions = [
        "trigger_sync_task",
        "trigger_metadata_task",
        "bulk_update_status_airing",
        "bulk_update_status_finished",
        "bulk_update_status_upcoming",
    ]

    def cover_preview(self, obj):
        """Display cover image preview."""
        if obj.cover_image:
            return format_html(
                '<img src="{}" style="max-height: 50px; max-width: 50px;" />',
                obj.cover_image.url,
            )
        return "-"

    cover_preview.short_description = "Cover"

    def status_badge(self, obj):
        """Display status with color-coded badge."""
        colors = {
            "Airing": "success",
            "Finished": "secondary",
            "Upcoming": "info",
            "Cancelled": "danger",
        }
        color = colors.get(obj.status, "secondary")
        return format_html('<span class="badge badge-{}">{}</span>', color, obj.status)

    status_badge.short_description = "Status"

    def rating_display(self, obj):
        """Display rating with stars."""
        if obj.rating:
            stars = "★" * int(obj.rating / 2)
            return format_html(
                '<span title="{}">{} {:.1f}</span>', obj.rating, stars, obj.rating
            )
        return "-"

    rating_display.short_description = "Rating"
    rating_display.admin_order_field = "rating"

    def favorites_count(self, obj):
        """Count of favorites."""
        return obj.favorites.count()

    favorites_count.short_description = "Favs"
    favorites_count.admin_order_field = "favorites_count"

    def reviews_count(self, obj):
        """Count of reviews."""
        return obj.reviews.count()

    reviews_count.short_description = "Revs"
    reviews_count.admin_order_field = "reviews_count"

    def average_rating(self, obj):
        """Calculate average rating from reviews."""
        from django.db.models import Avg

        avg = obj.reviews.aggregate(avg=Avg("rating"))["avg"]
        return f"{avg:.2f}" if avg else "N/A"

    average_rating.short_description = "Avg Rating (from reviews)"

    def total_reviews(self, obj):
        """Total review count."""
        return obj.reviews.count()

    total_reviews.short_description = "Total Reviews"

    def total_favorites(self, obj):
        """Total favorite count."""
        return obj.favorites.count()

    total_favorites.short_description = "Total Favorites"

    @admin.action(description="Trigger sync task for selected anime")
    def trigger_sync_task(self, request, queryset):
        """Trigger sync task for selected anime."""
        from celery import current_app

        triggered = 0
        for anime in queryset:
            try:
                # Trigger franchise sync for this anime
                current_app.send_task(
                    "anime.tasks.franchises.sync_franchises",
                    kwargs={"anime_id": anime.id},
                    queue="default",
                )
                triggered += 1
            except Exception as e:
                self.message_user(
                    request,
                    f"Failed to trigger task for {anime.title}: {e}",
                    level="error",
                )

        if triggered > 0:
            self.message_user(
                request, f"Sync tasks triggered for {triggered} anime.", level="success"
            )

    @admin.action(description="Trigger metadata enrichment for selected anime")
    def trigger_metadata_task(self, request, queryset):
        """Trigger metadata enrichment task."""
        from celery import current_app

        anime_ids = list(queryset.values_list("id", flat=True))

        try:
            # Trigger metadata task for batch
            current_app.send_task(
                "anime.tasks.metadata.enrich_metadata",
                kwargs={
                    "mode": "batch",
                    "anime_ids": anime_ids,
                },
                queue="low_priority",
            )
            self.message_user(
                request,
                f"Metadata enrichment triggered for {len(anime_ids)} anime.",
                level="success",
            )
        except Exception as e:
            self.message_user(
                request, f"Failed to trigger metadata task: {e}", level="error"
            )

    @admin.action(description="Update status to Airing")
    def bulk_update_status_airing(self, request, queryset):
        """Bulk update status to Airing."""
        count = queryset.update(status="Airing")
        self.message_user(request, f"{count} anime updated to Airing.")

    @admin.action(description="Update status to Finished")
    def bulk_update_status_finished(self, request, queryset):
        """Bulk update status to Finished."""
        count = queryset.update(status="Finished")
        self.message_user(request, f"{count} anime updated to Finished.")

    @admin.action(description="Update status to Upcoming")
    def bulk_update_status_upcoming(self, request, queryset):
        """Bulk update status to Upcoming."""
        count = queryset.update(status="Upcoming")
        self.message_user(request, f"{count} anime updated to Upcoming.")

    def get_queryset(self, request):
        """Optimize queryset with annotations."""
        return (
            super()
            .get_queryset(request)
            .prefetch_related("genres", "favorites", "reviews")
            .select_related("studio")
        )


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    """Admin for anime reviews."""

    list_display = [
        "id",
        "user",
        "anime_link",
        "rating_stars",
        "has_spoilers_badge",
        "created_at",
    ]

    list_filter = [
        "rating",
        "has_spoilers",
        ("created_at", admin.DateFieldListFilter),
    ]

    search_fields = [
        "user__username",
        "anime__title",
        "text",
    ]

    date_hierarchy = "created_at"
    ordering = ["-created_at"]

    readonly_fields = ["created_at", "updated_at"]

    fieldsets = (
        ("Review Information", {"fields": ("user", "anime", "rating", "has_spoilers")}),
        (
            "Content",
            {
                "fields": ("text",),
            },
        ),
        (
            "Metadata",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )

    actions = ["mark_has_spoilers", "mark_no_spoilers"]

    def anime_link(self, obj):
        """Display anime as link."""
        return format_html(
            '<a href="/admin/anime/anime/{}/change/">{}</a>',
            obj.anime.id,
            obj.anime.title[:30] + "..."
            if len(obj.anime.title) > 30
            else obj.anime.title,
        )

    anime_link.short_description = "Anime"
    anime_link.admin_order_field = "anime__title"

    def rating_stars(self, obj):
        """Display rating as stars."""
        stars = "★" * obj.rating
        return format_html('<span style="color: #ffc107;">{}</span>', stars)

    rating_stars.short_description = "Rating"
    rating_stars.admin_order_field = "rating"

    def has_spoilers_badge(self, obj):
        """Display spoiler status."""
        if obj.has_spoilers:
            return format_html('<span class="badge badge-warning">Spoilers</span>')
        return format_html('<span class="badge badge-secondary">No Spoilers</span>')

    has_spoilers_badge.short_description = "Spoilers"

    @admin.action(description="Mark selected as containing spoilers")
    def mark_has_spoilers(self, request, queryset):
        """Bulk mark reviews as having spoilers."""
        count = queryset.update(has_spoilers=True)
        self.message_user(request, f"{count} review(s) marked as containing spoilers.")

    @admin.action(description="Mark selected as not containing spoilers")
    def mark_no_spoilers(self, request, queryset):
        """Bulk mark reviews as not having spoilers."""
        count = queryset.update(has_spoilers=False)
        self.message_user(
            request, f"{count} review(s) marked as not containing spoilers."
        )

    def get_queryset(self, request):
        """Optimize queryset."""
        return super().get_queryset(request).select_related("user", "anime")
