"""Forum caching utilities for high-performance thread and post retrieval."""

from django.conf import settings
from django.core.cache import cache
from django.db.models import F

from ..shared.public_cache import invalidate_public_cache_keys

# Cache key templates
THREAD_LIST_CACHE_KEY = "forum:threads:{category_slug}:{tag_slug}:{page}:{ordering}"
THREAD_DETAIL_CACHE_KEY = "forum:thread:{thread_id}"
POST_LIST_CACHE_KEY = "forum:posts:{thread_id}:{page}"
CATEGORY_LIST_CACHE_KEY = "forum:categories"
CATEGORY_DETAIL_CACHE_KEY = "forum:category:{slug}"
TAG_LIST_CACHE_KEY = "forum:tags"
THREAD_VIEW_BUFFER_KEY = "forum:viewcount:thread:{thread_id}"
THREAD_VIEW_DIRTY_SET_KEY = "forum:viewcount:dirty"

# Cache TTLs (in seconds)
THREAD_LIST_CACHE_TTL = 300  # 5 minutes
THREAD_DETAIL_CACHE_TTL = 300  # 5 minutes
POST_LIST_CACHE_TTL = 300  # 5 minutes
CATEGORY_LIST_CACHE_TTL = 600  # 10 minutes
CATEGORY_DETAIL_CACHE_TTL = 300  # 5 minutes
TAG_LIST_CACHE_TTL = 3600  # 1 hour (tags rarely change)


def get_thread_list_cache_key(category_slug=None, tag_slug=None, page=1, ordering="-updated_at"):
    """Generate cache key for thread list"""
    return THREAD_LIST_CACHE_KEY.format(
        category_slug=category_slug or "all",
        tag_slug=tag_slug or "all",
        page=page,
        ordering=ordering,
    )


def get_thread_detail_cache_key(thread_id):
    """Generate cache key for thread detail"""
    return THREAD_DETAIL_CACHE_KEY.format(thread_id=thread_id)


def get_post_list_cache_key(thread_id, page=1):
    """Generate cache key for post list"""
    return POST_LIST_CACHE_KEY.format(thread_id=thread_id, page=page)


def get_category_list_cache_key():
    """Generate cache key for category list"""
    return CATEGORY_LIST_CACHE_KEY


def get_category_detail_cache_key(slug):
    """Generate cache key for category detail"""
    return CATEGORY_DETAIL_CACHE_KEY.format(slug=slug)


def get_tag_list_cache_key():
    """Generate cache key for tag list"""
    return TAG_LIST_CACHE_KEY


def cache_thread_list(
    data, category_slug=None, tag_slug=None, page=1, ordering="-updated_at", timeout=None
):
    """Cache thread list data"""
    key = get_thread_list_cache_key(category_slug, tag_slug, page, ordering)
    cache.set(key, data, timeout or THREAD_LIST_CACHE_TTL)
    return data


def get_cached_thread_list(category_slug=None, tag_slug=None, page=1, ordering="-updated_at"):
    """Get cached thread list data"""
    key = get_thread_list_cache_key(category_slug, tag_slug, page, ordering)
    return cache.get(key)


# Only these orderings are cached, so invalidation can enumerate every key.
CACHEABLE_THREAD_ORDERINGS = ("-updated_at", "-created_at", "-view_count")
CACHEABLE_THREAD_LIST_PARAMS = frozenset({"category__slug", "tags__slug", "page", "ordering"})
CACHEABLE_POST_LIST_PARAMS = frozenset({"thread__id", "page", "ordering"})
CACHEABLE_POST_ORDERING = "created_at"


def invalidate_thread_list_cache(category_slug=None):
    """Invalidate the cached thread lists a thread in ``category_slug`` appears in.

    That is the category's own list and the all-categories list (first 10
    pages each). Tag-filtered lists are left to expire.
    """
    for slug in {category_slug, None}:
        for page in range(1, 11):
            for ordering in CACHEABLE_THREAD_ORDERINGS:
                key = get_thread_list_cache_key(slug, None, page, ordering)
                invalidate_public_cache_keys(key)


def cache_thread_detail(thread_id, data, timeout=None):
    """Cache thread detail data"""
    key = get_thread_detail_cache_key(thread_id)
    cache.set(key, data, timeout or THREAD_DETAIL_CACHE_TTL)
    return data


def get_cached_thread_detail(thread_id):
    """Get cached thread detail data"""
    key = get_thread_detail_cache_key(thread_id)
    return cache.get(key)


def invalidate_thread_detail_cache(thread_id):
    """Invalidate thread detail cache"""
    key = get_thread_detail_cache_key(thread_id)
    invalidate_public_cache_keys(key)


def cache_post_list(thread_id, page, data, timeout=None):
    """Cache post list data"""
    key = get_post_list_cache_key(thread_id, page)
    cache.set(key, data, timeout or POST_LIST_CACHE_TTL)
    return data


def get_cached_post_list(thread_id, page=1):
    """Get cached post list data"""
    key = get_post_list_cache_key(thread_id, page)
    return cache.get(key)


def invalidate_post_list_cache(thread_id):
    """Invalidate all post list cache for a thread"""
    for page in range(1, 21):  # Clear first 20 pages
        key = get_post_list_cache_key(thread_id, page)
        invalidate_public_cache_keys(key)


def cache_category_list(data, timeout=None):
    """Cache category list data"""
    key = get_category_list_cache_key()
    cache.set(key, data, timeout or CATEGORY_LIST_CACHE_TTL)
    return data


def get_cached_category_list():
    """Get cached category list data"""
    key = get_category_list_cache_key()
    return cache.get(key)


def invalidate_category_list_cache():
    """Invalidate category list cache"""
    key = get_category_list_cache_key()
    invalidate_public_cache_keys(key)


def cache_category_detail(slug, data, timeout=None):
    """Cache category detail data"""
    key = get_category_detail_cache_key(slug)
    cache.set(key, data, timeout or CATEGORY_DETAIL_CACHE_TTL)
    return data


def get_cached_category_detail(slug):
    """Get cached category detail data"""
    key = get_category_detail_cache_key(slug)
    return cache.get(key)


def invalidate_category_detail_cache(slug):
    """Invalidate category detail cache"""
    key = get_category_detail_cache_key(slug)
    invalidate_public_cache_keys(key)


def cache_tag_list(data, timeout=None):
    """Cache tag list data"""
    key = get_tag_list_cache_key()
    cache.set(key, data, timeout or TAG_LIST_CACHE_TTL)
    return data


def get_cached_tag_list():
    """Get cached tag list data"""
    key = get_tag_list_cache_key()
    return cache.get(key)


def invalidate_tag_list_cache():
    """Invalidate tag list cache"""
    key = get_tag_list_cache_key()
    invalidate_public_cache_keys(key)


# Convenience function to invalidate all caches related to a thread
def invalidate_thread_caches(thread_id, category_slug=None):
    """Invalidate all caches related to a specific thread"""
    invalidate_thread_detail_cache(thread_id)
    invalidate_post_list_cache(thread_id)
    if category_slug:
        invalidate_thread_list_cache(category_slug)
    invalidate_category_list_cache()


def get_thread_view_buffer_key(thread_id: int) -> str:
    return THREAD_VIEW_BUFFER_KEY.format(thread_id=thread_id)


def _get_redis_connection():
    try:
        from django_redis import get_redis_connection

        return get_redis_connection("default")
    except Exception:
        return None


def buffer_thread_view_increment(thread_id: int) -> None:
    ttl = max(int(getattr(settings, "FORUM_VIEW_BUFFER_TTL_SECONDS", 7200)), 60)
    redis_conn = _get_redis_connection()
    if redis_conn is not None:
        key = get_thread_view_buffer_key(thread_id)
        pipeline = redis_conn.pipeline()
        pipeline.incr(key)
        pipeline.expire(key, ttl)
        pipeline.sadd(THREAD_VIEW_DIRTY_SET_KEY, thread_id)
        pipeline.expire(THREAD_VIEW_DIRTY_SET_KEY, ttl)
        pipeline.execute()
        return

    key = get_thread_view_buffer_key(thread_id)
    if not cache.add(key, 1, timeout=ttl):
        try:
            cache.incr(key)
        except ValueError:
            current = int(cache.get(key) or 0)
            cache.set(key, current + 1, timeout=ttl)

    dirty_ids = set(cache.get(THREAD_VIEW_DIRTY_SET_KEY) or [])
    dirty_ids.add(int(thread_id))
    cache.set(THREAD_VIEW_DIRTY_SET_KEY, sorted(dirty_ids), timeout=ttl)


def flush_buffered_thread_views(*, max_threads: int | None = None) -> dict[str, int]:
    from .models import Thread

    batch_size = max_threads or max(int(getattr(settings, "FORUM_VIEW_FLUSH_BATCH_SIZE", 500)), 1)
    flushed = 0
    missing = 0

    redis_conn = _get_redis_connection()
    if redis_conn is not None:
        raw_ids = list(redis_conn.smembers(THREAD_VIEW_DIRTY_SET_KEY))[:batch_size]
        for raw_id in raw_ids:
            thread_id = int(raw_id)
            key = get_thread_view_buffer_key(thread_id)
            count = int(redis_conn.get(key) or 0)
            pipeline = redis_conn.pipeline()
            pipeline.srem(THREAD_VIEW_DIRTY_SET_KEY, raw_id)
            pipeline.delete(key)
            pipeline.execute()
            if count <= 0:
                continue
            updated = Thread.objects.filter(pk=thread_id).update(view_count=F("view_count") + count)
            if updated:
                flushed += count
            else:
                missing += count
        return {"flushed": flushed, "missing": missing, "processed_threads": len(raw_ids)}

    dirty_ids = list(cache.get(THREAD_VIEW_DIRTY_SET_KEY) or [])[:batch_size]
    remaining_ids = list(cache.get(THREAD_VIEW_DIRTY_SET_KEY) or [])
    for thread_id in dirty_ids:
        key = get_thread_view_buffer_key(thread_id)
        count = int(cache.get(key) or 0)
        invalidate_public_cache_keys(key)
        if thread_id in remaining_ids:
            remaining_ids.remove(thread_id)
        if count <= 0:
            continue
        updated = Thread.objects.filter(pk=thread_id).update(view_count=F("view_count") + count)
        if updated:
            flushed += count
        else:
            missing += count
    cache.set(
        THREAD_VIEW_DIRTY_SET_KEY,
        remaining_ids,
        timeout=max(int(getattr(settings, "FORUM_VIEW_BUFFER_TTL_SECONDS", 7200)), 60),
    )
    return {"flushed": flushed, "missing": missing, "processed_threads": len(dirty_ids)}
