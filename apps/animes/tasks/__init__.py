"""Unified Celery tasks for anime synchronization and enrichment.

This module provides a consolidated task system with:
- Base task classes with common functionality
- Unified sync workflows for AniList data
- Airing workflow with chained sub-tasks
- Metadata enrichment with batching
- Theme song YouTube-link upkeep
- Recommendation generation
- Franchise/relations synchronization

Usage:
    from . import run_catalog_lane, sync_airing_workflow

    # Refresh trending from AniList (see apps.animes.catalog for every lane)
    run_catalog_lane.delay(lane='trending')

    # Run full airing workflow
    sync_airing_workflow.delay()

    # Sync franchises for a single anime (imports missing to ensure all slugs linked)
    sync_franchises.delay(anime_id=123)

    # Batch sync franchises for anime missing relations
    sync_franchises.delay(mode='backfill', batch_size=50)

    # Update relation slugs (run periodically to fix broken links)
    update_relation_slugs.delay(batch_size=100)
"""

# Import all task modules to ensure registration
from .adult_content import replay_public_cache_invalidations, sync_adult_flags
from .airing import sync_airing_workflow
from .catalog import run_catalog_lane
from .franchises import sync_franchises, update_relation_slugs

# Import legacy tasks from tasks.py (kept for backward compatibility)
from .images import generate_image_thumbnails, heal_missing_anime_media
from .metadata import enrich_metadata
from .recommendations import generate_recommendations
from .themes import backfill_theme_youtube_urls
from .watch_episodes import sync_watch_episodes_batch, sync_watch_episodes_for_anime

# Import legacy tasks to ensure they're registered
# These are in tasks_legacy.py but imported via celery autodiscover

__all__ = [
    "backfill_theme_youtube_urls",
    "enrich_metadata",
    "generate_image_thumbnails",
    "generate_recommendations",
    "heal_missing_anime_media",
    "replay_public_cache_invalidations",
    "run_catalog_lane",
    "sync_adult_flags",
    "sync_airing_workflow",
    "sync_franchises",
    "sync_watch_episodes_batch",
    "sync_watch_episodes_for_anime",
    "update_relation_slugs",
]
