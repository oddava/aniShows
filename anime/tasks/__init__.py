"""
Unified Celery tasks for anime synchronization and enrichment.

This module provides a consolidated task system with:
- Base task classes with common functionality
- Unified sync workflows for AniList data
- Airing workflow with chained sub-tasks
- Metadata enrichment with batching
- Theme song synchronization
- Recommendation generation

Usage:
    from anime.tasks import sync_anime_catalog, sync_airing_workflow

    # Sync trending anime
    sync_anime_catalog.delay(sync_type='trending', limit=50)

    # Run full airing workflow
    sync_airing_workflow.delay()
"""

"""
Unified Celery tasks for anime synchronization and enrichment.

This module provides a consolidated task system with:
- Base task classes with common functionality
- Unified sync workflows for AniList data
- Airing workflow with chained sub-tasks
- Metadata enrichment with batching
- Theme song synchronization
- Recommendation generation

Usage:
    from anime.tasks import sync_anime_catalog, sync_airing_workflow

    # Sync trending anime
    sync_anime_catalog.delay(sync_type='trending', limit=50)

    # Run full airing workflow
    sync_airing_workflow.delay()

Legacy tasks:
    Legacy tasks from anime/tasks.py can still be imported directly:
    from anime.tasks import sync_trending_anime  # Old import still works
"""

from .sync import sync_anime_catalog
from .airing import sync_airing_workflow
from .metadata import enrich_metadata
from .themes import sync_theme_songs
from .recommendations import generate_recommendations

__all__ = [
    "sync_anime_catalog",
    "sync_airing_workflow",
    "enrich_metadata",
    "sync_theme_songs",
    "generate_recommendations",
]
