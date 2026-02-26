"""
Unified Celery tasks for anime synchronization and enrichment.

This module provides a consolidated task system with:
- Base task classes with common functionality
- Unified sync workflows for AniList data
- Airing workflow with chained sub-tasks
- Metadata enrichment with batching
- Theme song synchronization
- Recommendation generation
- Franchise/relations synchronization

Usage:
    from apps.animes.tasks import sync_anime_catalog, sync_airing_workflow

    # Sync trending anime
    sync_anime_catalog.delay(sync_type='trending', limit=50)

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
from .sync import sync_anime_catalog
from .airing import sync_airing_workflow
from .metadata import enrich_metadata
from .themes import sync_theme_songs, backfill_theme_youtube_urls
from .recommendations import generate_recommendations
from .franchises import sync_franchises, update_relation_slugs

# Import legacy tasks from tasks.py (kept for backward compatibility)
from .images import generate_image_thumbnails

# Import legacy tasks to ensure they're registered
# These are in tasks_legacy.py but imported via celery autodiscover

__all__ = [
    "sync_anime_catalog",
    "sync_airing_workflow",
    "enrich_metadata",
    "sync_theme_songs",
    "backfill_theme_youtube_urls",
    "generate_recommendations",
    "generate_image_thumbnails",
    "sync_franchises",
    "update_relation_slugs",
]
