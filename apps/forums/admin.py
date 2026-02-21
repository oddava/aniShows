from django.contrib import admin
from .models import Category, Thread, Post, Tag, ThreadLike, PostLike


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'order', 'thread_count')
    prepopulated_fields = {'slug': ('name',)}
    ordering = ('order', 'name')

    def thread_count(self, obj):
        return obj.threads.count()
    thread_count.short_description = 'Threads'


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'color')
    prepopulated_fields = {'slug': ('name',)}


@admin.register(Thread)
class ThreadAdmin(admin.ModelAdmin):
    list_display = ('title', 'author', 'category', 'is_pinned', 'is_locked', 'view_count', 'created_at')
    list_filter = ('category', 'is_pinned', 'is_locked', 'tags')
    search_fields = ('title', 'content', 'author__username')
    raw_id_fields = ('author',)
    filter_horizontal = ('tags',)
    readonly_fields = ('view_count', 'created_at', 'updated_at')


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'author', 'thread', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('content', 'author__username')
    raw_id_fields = ('author', 'thread')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(ThreadLike) 
class ThreadLikeAdmin(admin.ModelAdmin):
    list_display = ('user', 'thread', 'created_at')
    raw_id_fields = ('user', 'thread')


@admin.register(PostLike)
class PostLikeAdmin(admin.ModelAdmin):
    list_display = ('user', 'post', 'created_at')
    raw_id_fields = ('user', 'post')
