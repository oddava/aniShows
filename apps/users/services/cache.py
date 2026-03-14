from apps.shared.logger import logger

"""
Cache invalidation utilities for user-related data.

This module provides centralized cache invalidation to ensure that when
user actions occur, all relevant caches are properly invalidated.
"""

from django.core.cache import cache


def invalidate_user_caches(user_id, username=None, trigger_stats_update=True):
    """
    Invalidate all caches related to a specific user.

    This should be called whenever a user performs an action that affects
    their profile stats, such as:
    - Adding/removing anime from their list
    - Adding/removing favorites
    - Writing/deleting a review
    - Following/unfollowing someone
    - Updating their profile

    Args:
        user_id: The user's ID
        username: The user's username (optional, for public profile cache)
        trigger_stats_update: Whether to trigger an async stats update (default True)
    """
    # Delete profile caches
    cache.delete(get_user_profile_cache_key(user_id, full=False))
    cache.delete(get_user_profile_cache_key(user_id, full=True))
    cache.delete(get_user_stats_cache_key(user_id))

    # Delete public profile caches if username provided
    if username:
        # Increment cache version to invalidate all public profile cache keys.
        # We no longer use cache.delete_pattern as it blocks the Redis event loop.
        # Instead, we rely on versioned keys which will naturally expire.
        version_key = f"profile_cache_version:{username}"
        try:
            cache.incr(version_key)
            logger.debug(f"Incremented cache version for {username}")
        except ValueError:
            # If the key doesn't exist, set it to 1
            cache.set(version_key, 1, timeout=86400)  # Long timeout as it's a version counter
            logger.debug(f"Initialized cache version for {username}")
        except Exception as e:
            logger.warning(f"Failed to increment cache version for {username}: {e}")

    # Trigger async stats update for immediate data consistency
    if trigger_stats_update:
        try:
            from apps.users.tasks import update_user_stats

            update_user_stats.delay(user_id)
            logger.debug(f"Triggered stats update for user {user_id}")
        except Exception as e:
            logger.warning(f"Failed to trigger stats update for user {user_id}: {e}")

    logger.debug(f"Invalidated caches for user {user_id}")

def invalidate_user_anime_caches(user_id):
    """Clear user-specific anime caches when their list changes."""
    cache.delete(f"anime_trending_{user_id}")
    cache.delete(f"anime_top_rated_{user_id}")

def invalidate_anime_detail_cache(anime_slug, user_id=None):
    """Clear anime detail cache for a specific anime.

    Args:
        anime_slug: The anime's slug
        user_id: The user's ID (optional - if None, clears all user-specific caches for this anime)
    """
    if user_id:
        cache.delete(f"anime_detail:{anime_slug}:{user_id}")
    else:
        # If no user_id provided, we can't easily clear all user-specific caches
        # but the cache key includes user_id, so we just document this limitation
        pass

def get_user_profile_cache_key(user_id, full=False):
    """Get the cache key for a user's profile."""
    return f"user_profile:{user_id}:{'full' if full else 'light'}"

def get_user_stats_cache_key(user_id):
    """Get the cache key for a user's stats."""
    return f"user_stats:{user_id}"

def get_user_heatmap_cache_key(user_id):
    """Get the cache key for a user's activity heatmap."""
    return f"heatmap:{user_id}"

def get_public_profile_cache_key(username, viewer_id="anonymous"):
    """Get the cache key for a public profile, including the current version."""
    version = get_profile_cache_version(username)
    return f"public_profile:{username}:v{version}:viewer:{viewer_id}"

def get_profile_cache_version(username):
    """Get the current cache version for a user's profile."""
    version_key = f"profile_cache_version:{username}"
    version = cache.get(version_key)
    if version is None:
        cache.set(version_key, 0, timeout=3600)
        return 0
    return version

def get_user_online_cache_key(user_id):
    """Get the cache key for user online status."""
    return f"user_online:{user_id}"
