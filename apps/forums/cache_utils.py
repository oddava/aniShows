"""
Forum caching utilities for high-performance thread/post retrieval.
"""

from django.core.cache import cache


# Cache key templates
THREAD_LIST_CACHE_KEY = "forum:threads:{category_slug}:{tag_slug}:{page}:{ordering}"
THREAD_DETAIL_CACHE_KEY = "forum:thread:{thread_id}"
POST_LIST_CACHE_KEY = "forum:posts:{thread_id}:{page}"
CATEGORY_LIST_CACHE_KEY = "forum:categories"
CATEGORY_DETAIL_CACHE_KEY = "forum:category:{slug}"
TAG_LIST_CACHE_KEY = "forum:tags"

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


def invalidate_thread_list_cache(category_slug=None):
    """Invalidate thread list cache for a category"""
    # Pattern-based cache invalidation is not directly supported,
    # so we'll use a version-based approach or cache tags if available
    # For now, we'll clear specific known keys
    if category_slug:
        for page in range(1, 11):  # Clear first 10 pages
            for ordering in ["-updated_at", "-created_at", "-view_count"]:
                key = get_thread_list_cache_key(category_slug, None, page, ordering)
                cache.delete(key)


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
    cache.delete(key)


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
        cache.delete(key)


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
    cache.delete(key)


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
    cache.delete(key)


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
    cache.delete(key)


# Convenience function to invalidate all caches related to a thread
def invalidate_thread_caches(thread_id, category_slug=None):
    """Invalidate all caches related to a specific thread"""
    invalidate_thread_detail_cache(thread_id)
    invalidate_post_list_cache(thread_id)
    if category_slug:
        invalidate_thread_list_cache(category_slug)
    invalidate_category_list_cache()
