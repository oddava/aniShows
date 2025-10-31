from django.contrib import admin
from .models import Anime, Genre, Studio, UserFavorite, UserHistory, Review


@admin.register(Genre)
class GenreAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    search_fields = ('name',)


@admin.register(Studio)
class StudioAdmin(admin.ModelAdmin):
    list_display = ('name', 'founded_date')
    search_fields = ('name',)


@admin.register(Anime)
class AnimeAdmin(admin.ModelAdmin):
    list_display = ('title', 'anime_type', 'status', 'rating', 'episode_count', 'release_date')
    list_filter = ('status', 'anime_type', 'genres')
    search_fields = ('title', 'title_english', 'title_japanese')
    prepopulated_fields = {'slug': ('title',)}
    filter_horizontal = ('genres',)
    date_hierarchy = 'release_date'

    fieldsets = (
        ('Basic Information', {
            'fields': ('title', 'title_english', 'title_japanese', 'slug', 'synopsis')
        }),
        ('Classification', {
            'fields': ('anime_type', 'status', 'genres', 'studio')
        }),
        ('Episodes & Duration', {
            'fields': ('episode_count', 'duration_minutes', 'release_date', 'end_date')
        }),
        ('Media', {
            'fields': ('cover_image', 'banner_image', 'trailer_url')
        }),
        ('Rating', {
            'fields': ('rating',)
        }),
        ('SEO', {
            'fields': ('meta_description',),
            'classes': ('collapse',)
        }),
    )


@admin.register(UserFavorite)
class UserFavoriteAdmin(admin.ModelAdmin):
    list_display = ('user', 'anime', 'added_at')
    list_filter = ('added_at',)
    search_fields = ('user__username', 'anime__title')
    date_hierarchy = 'added_at'


@admin.register(UserHistory)
class UserHistoryAdmin(admin.ModelAdmin):
    list_display = ('user', 'anime', 'viewed_at')
    list_filter = ('viewed_at',)
    search_fields = ('user__username', 'anime__title')
    date_hierarchy = 'viewed_at'


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ('user', 'anime', 'rating', 'created_at')
    list_filter = ('rating', 'created_at')
    search_fields = ('user__username', 'anime__title', 'text')
    date_hierarchy = 'created_at'