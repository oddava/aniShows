from django.db import transaction
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import Post, ThreadLike, PostLike, Thread, Category
from .cache_utils import (
    invalidate_thread_caches,
    invalidate_thread_detail_cache,
    invalidate_post_list_cache,
    invalidate_category_list_cache,
    invalidate_category_detail_cache,
    invalidate_thread_list_cache,
)


def invalidate_after_commit(cache_invalidation_func):
    """Helper to delay cache invalidation until transaction commits.

    This prevents race conditions where concurrent requests cache stale data
    before the transaction that invalidated the cache has committed.
    """
    transaction.on_commit(cache_invalidation_func)


@receiver(post_save, sender=Post)
def update_thread_on_post_create(sender, instance, created, **kwargs):
    """Update thread reply count and invalidate caches when a post is created"""
    if created:
        instance.thread.update_reply_count()
        instance.thread.category.update_thread_count()
        # Invalidate caches AFTER transaction commits to prevent race conditions
        invalidate_after_commit(
            lambda: invalidate_thread_caches(instance.thread.id, instance.thread.category.slug)
        )
        invalidate_after_commit(lambda: invalidate_post_list_cache(instance.thread.id))


@receiver(post_delete, sender=Post)
def update_thread_on_post_delete(sender, instance, **kwargs):
    """Update thread reply count and invalidate caches when a post is deleted"""
    instance.thread.update_reply_count()
    # Invalidate caches AFTER transaction commits
    invalidate_after_commit(
        lambda: invalidate_thread_caches(instance.thread.id, instance.thread.category.slug)
    )
    invalidate_after_commit(lambda: invalidate_post_list_cache(instance.thread.id))


@receiver(post_save, sender=ThreadLike)
def update_thread_like_count_on_create(sender, instance, created, **kwargs):
    """Update thread like count when a like is created"""
    if created:
        instance.thread.update_like_count()
        # Invalidate thread detail cache AFTER transaction commits (likes changed)
        invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.thread.id))


@receiver(post_delete, sender=ThreadLike)
def update_thread_like_count_on_delete(sender, instance, **kwargs):
    """Update thread like count when a like is deleted"""
    instance.thread.update_like_count()
    # Invalidate thread detail cache AFTER transaction commits (likes changed)
    invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.thread.id))


@receiver(post_save, sender=PostLike)
def update_post_like_count_on_create(sender, instance, created, **kwargs):
    """Update post like count when a like is created"""
    if created:
        instance.post.update_like_count()
        # Invalidate post list cache AFTER transaction commits
        invalidate_after_commit(lambda: invalidate_post_list_cache(instance.post.thread.id))


@receiver(post_delete, sender=PostLike)
def update_post_like_count_on_delete(sender, instance, **kwargs):
    """Update post like count when a like is deleted"""
    instance.post.update_like_count()
    # Invalidate post list cache AFTER transaction commits
    invalidate_after_commit(lambda: invalidate_post_list_cache(instance.post.thread.id))


@receiver(post_save, sender=Thread)
def update_category_on_thread_create(sender, instance, created, **kwargs):
    """Update category thread count and invalidate caches when a thread is created"""
    if created:
        instance.category.update_thread_count()
        # Invalidate caches AFTER transaction commits
        invalidate_after_commit(invalidate_category_list_cache)
        invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.category.slug))
        invalidate_after_commit(lambda: invalidate_thread_list_cache(instance.category.slug))


@receiver(post_delete, sender=Thread)
def update_category_on_thread_delete(sender, instance, **kwargs):
    """Update category thread count and invalidate caches when a thread is deleted"""
    instance.category.update_thread_count()
    # Invalidate caches AFTER transaction commits
    invalidate_after_commit(invalidate_category_list_cache)
    invalidate_after_commit(lambda: invalidate_category_detail_cache(instance.category.slug))
    invalidate_after_commit(lambda: invalidate_thread_list_cache(instance.category.slug))
    invalidate_after_commit(lambda: invalidate_thread_detail_cache(instance.id))
