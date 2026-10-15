from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .cache_utils import (
    invalidate_category_detail_cache,
    invalidate_category_list_cache,
    invalidate_post_list_cache,
    invalidate_tag_list_cache,
    invalidate_thread_caches,
    invalidate_thread_detail_cache,
    invalidate_thread_list_cache,
)
from .models import Category, Post, PostLike, Tag, Thread, ThreadLike


def invalidate_after_commit(cache_invalidation_func):
    """Helper to delay cache invalidation until transaction commits.

    This prevents race conditions where concurrent requests cache stale data
    before the transaction that invalidated the cache has committed.
    """
    transaction.on_commit(cache_invalidation_func)

def _obj_exists(model, pk):
    """Check if a model instance still exists in the database."""
    if not pk:
        return False
    return model.objects.filter(pk=pk).exists()

@receiver(post_save, sender=Post)
def update_thread_on_post_create(sender, instance, created, **kwargs):
    """Update thread reply count and invalidate caches when a post is created"""
    if created:
        instance.thread.adjust_reply_count(1)
        # Invalidate caches AFTER transaction commits to prevent race conditions
        invalidate_after_commit(
            lambda: invalidate_thread_caches(instance.thread.id)
        )
        invalidate_after_commit(lambda: invalidate_post_list_cache(instance.thread.id))

@receiver(post_delete, sender=Post)
def update_thread_on_post_delete(sender, instance, **kwargs):
    """Update thread reply count and invalidate caches when a post is deleted"""
    # Skip if thread is also being deleted (cascade from user deletion)
    if not _obj_exists(Thread, instance.thread_id):
        return

    instance.thread.adjust_reply_count(-1)
    # Invalidate caches AFTER transaction commits
    invalidate_after_commit(
        lambda: invalidate_thread_caches(instance.thread.id)
    )
    invalidate_after_commit(lambda: invalidate_post_list_cache(instance.thread.id))

@receiver(post_save, sender=ThreadLike)
def update_thread_like_count_on_create(sender, instance, created, **kwargs):
    """Update thread like count when a like is created"""
    if created:
        instance.thread.adjust_like_count(1)
        # Invalidate thread detail cache AFTER transaction commits (likes changed)
        invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.thread.id))

@receiver(post_delete, sender=ThreadLike)
def update_thread_like_count_on_delete(sender, instance, **kwargs):
    """Update thread like count when a like is deleted"""
    # Skip if thread is also being deleted (cascade from user deletion)
    if not _obj_exists(Thread, instance.thread_id):
        return

    instance.thread.adjust_like_count(-1)
    # Invalidate thread detail cache AFTER transaction commits (likes changed)
    invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.thread.id))

@receiver(post_save, sender=PostLike)
def update_post_like_count_on_create(sender, instance, created, **kwargs):
    """Update post like count when a like is created"""
    if created:
        instance.post.adjust_like_count(1)
        # Invalidate post list cache AFTER transaction commits
        invalidate_after_commit(lambda: invalidate_post_list_cache(instance.post.thread.id))

@receiver(post_delete, sender=PostLike)
def update_post_like_count_on_delete(sender, instance, **kwargs):
    """Update post like count when a like is deleted"""
    # Skip if post is also being deleted (cascade from user/thread deletion)
    if not _obj_exists(Post, instance.post_id):
        return

    instance.post.adjust_like_count(-1)
    # Invalidate post list cache AFTER transaction commits
    invalidate_after_commit(lambda: invalidate_post_list_cache(instance.post.thread.id))

@receiver(post_save, sender=Category)
def invalidate_cache_on_category_save(sender, instance, **kwargs):
    """Invalidate category caches when a category is created or updated."""
    invalidate_after_commit(invalidate_category_list_cache)
    invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.slug))

@receiver(post_delete, sender=Category)
def invalidate_cache_on_category_delete(sender, instance, **kwargs):
    """Invalidate category caches when a category is deleted."""
    invalidate_after_commit(invalidate_category_list_cache)
    invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.slug))

@receiver(post_save, sender=Tag)
@receiver(post_delete, sender=Tag)
def invalidate_cache_on_tag_change(sender, instance, **kwargs):
    """The tag list is cached for an hour; admin edits must show at once."""
    invalidate_after_commit(invalidate_tag_list_cache)

@receiver(post_save, sender=Thread)
def update_category_on_thread_create(sender, instance, created, **kwargs):
    """Update category thread count and invalidate caches when a thread is created"""
    if created:
        instance.category.adjust_thread_count(1)
        # Invalidate caches AFTER transaction commits
        invalidate_after_commit(invalidate_category_list_cache)
        invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.category.slug))
        invalidate_after_commit(invalidate_thread_list_cache)

@receiver(post_delete, sender=Thread)
def update_category_on_thread_delete(sender, instance, **kwargs):
    """Update category thread count and invalidate caches when a thread is deleted"""
    # Category should still exist (not cascade-deleted with user)
    if not _obj_exists(Category, instance.category_id):
        return

    instance.category.adjust_thread_count(-1)
    # Invalidate caches AFTER transaction commits
    invalidate_after_commit(invalidate_category_list_cache)
    invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.category.slug))
    invalidate_after_commit(invalidate_thread_list_cache)
    invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.id))
