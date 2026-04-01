# Celery

## Overview

aniShows uses Celery for catalog sync, enrichment, notifications, user maintenance, and operational background work.

As of this refactor:

- Task entrypoints use a shared task definition helper from `apps/shared/celery.py`.
- Task wrappers stay thin and delegate to service-layer code where practical.
- Lifecycle logging is consistent across tasks: start, retry, success, and failure.
- Persistent task results default to `django-celery-results` via `CELERY_RESULT_BACKEND = "django-db"`.
- Extended result metadata is enabled with `CELERY_RESULT_EXTENDED = True`.

## Retry Policies

Shared retry policies live in [apps/shared/celery.py](/home/oddava/Projects/aniShows/apps/shared/celery.py).

`none`
- No automatic retries.

`quick`
- `max_retries=2`
- `default_retry_delay=30`
- backoff enabled
- intended for small internal tasks and logging

`standard`
- `max_retries=3`
- `default_retry_delay=60`
- backoff enabled
- intended for most DB-backed and orchestration tasks

`external_api`
- `max_retries=5`
- `default_retry_delay=60`
- backoff enabled
- intended for AniList/Jikan/Resend style network calls

`long`
- `max_retries=3`
- `default_retry_delay=180`
- backoff enabled
- intended for large batch imports and long-running sync jobs

## Task Inventory

### Anime Tasks

`apps.animes.tasks.sync.sync_anime_catalog`
- Sync AniList catalog slices such as trending, seasonal, next season, and airing.
- The `full_catalog` mode fetches a broader top 5000 slice for admin-triggered backfills.

`apps.animes.tasks.airing.sync_airing_workflow`
- Runs airing-date sync, cleanup, and backfill phases.

`apps.animes.tasks.metadata.enrich_metadata`
- Enriches detailed metadata for one anime or a prioritized batch.

`apps.animes.tasks.franchises.sync_franchises`
- Syncs relation/franchise data from AniList.

`apps.animes.tasks.franchises.update_relation_slugs`
- Repairs missing relation slugs for already-linked franchise entries.

`apps.animes.tasks.themes.sync_theme_songs`
- Syncs opening and ending themes from Jikan.

`apps.animes.tasks.themes.backfill_theme_youtube_urls`
- Fills missing YouTube search URLs for saved theme rows.

`apps.animes.tasks.images.fetch_anime_images`
- Downloads and stores cover and banner images.

`apps.animes.tasks.images.generate_image_thumbnails`
- Generates local thumbnails for anime media.

`apps.animes.tasks.images.heal_missing_anime_media`
- Periodic self-heal for anime that are missing local media.

`apps.animes.tasks.offline_catalog.import_offline_catalog`
- Imports Anime Offline Database releases.

`apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync`
- Reconciles offline-imported anime through metadata, franchise, and theme stages.

`apps.animes.tasks.recommendations.generate_recommendations`
- Generates recommendation rows for one user or all active users.

### Core Tasks

`apps.core.tasks.notifications.send_pending_notifications`
- Delivers queued email and push notifications.

`apps.core.tasks.notifications.check_new_episodes`
- Detects recently aired episodes and creates notification rows.

`apps.core.tasks.notifications.cleanup_old_notifications_task`
- Deletes stale notifications.

`apps.core.tasks.cleanup_tasks.cleanup_old_task_results`
- Cleans up the custom `core.CeleryTaskResult` table.

`apps.core.tasks.cleanup_tasks.cleanup_celery_backend`
- Placeholder backend-cleanup task kept for compatibility.

`apps.core.tasks.cleanup_tasks.health_check_workers`
- Reports worker heartbeat health.

`apps.core.tasks.cleanup_tasks.flush_forum_view_counts`
- Flushes buffered anonymous forum thread views to the database.

`apps.core.tasks.metadata.fetch_link_metadata_async`
- Fetches and stores metadata for a single social link.

`apps.core.tasks.metadata.fetch_multiple_link_metadata`
- Batch-fetches social-link metadata.

`apps.core.tasks.logging_tasks.log_request_async`
- Asynchronously persists request logs.

`apps.core.tasks.logging_tasks.log_audit_async`
- Asynchronously persists audit logs.

`apps.core.tasks.logging_tasks.log_exception_async`
- Asynchronously persists exception logs.

### User Tasks

`apps.users.tasks.cleanup_unverified_accounts`
- Deletes stale, unverified accounts with related cleanup.

`apps.users.tasks.process_import_job`
- Runs a user import job.

`apps.users.tasks.fetch_anime_by_external_id`
- Resolves missing anime rows from AniList/MAL/title identifiers.

`apps.users.tasks.cleanup_old_import_jobs`
- Deletes completed or failed import jobs older than a retention window.

`apps.users.tasks.run_user_maintenance_workflow`
- Orchestrates user cleanup jobs.

`apps.users.tasks.update_user_stats`
- Recomputes user statistics for one user or the active-user set.

`apps.users.tasks.update_all_user_stats`
- Queues a full `update_user_stats` run.

`apps.users.tasks.warm_profile_cache`
- Pre-warms public profile cache entries.

`apps.users.services.email_service.send_email_task`
- Sends transactional email through Django backends or Resend.

## Periodic Schedules

Beat schedules are defined in [root/settings/base.py](/home/oddava/Projects/aniShows/root/settings/base.py).

### Hourly and Sub-Hourly

`sync-trending-hourly`
- `apps.animes.tasks.sync.sync_anime_catalog`
- hourly at `:05`

`sync-airing-workflow-hourly`
- `apps.animes.tasks.airing.sync_airing_workflow`
- hourly at `:30`

`reconcile-offline-catalog-sync-hourly`
- `apps.animes.tasks.offline_catalog.reconcile_offline_catalog_sync`
- hourly at `:45`

`update-user-stats-5min`
- `apps.users.tasks.update_all_user_stats`
- every 5 minutes

`warm-profile-cache-hourly`
- `apps.users.tasks.warm_profile_cache`
- hourly at `:00`

`heal-missing-media-30min`
- `apps.animes.tasks.images.heal_missing_anime_media`
- every 30 minutes

`send-pending-notifications`
- `apps.core.tasks.notifications.send_pending_notifications`
- every 10 minutes

`health-check-workers-hourly`
- `apps.core.tasks.cleanup_tasks.health_check_workers`
- hourly at `:15`

`flush-forum-view-counts-minute`
- `apps.core.tasks.cleanup_tasks.flush_forum_view_counts`
- every minute

### Daily

`sync-seasonal-daily`
- `apps.animes.tasks.sync.sync_anime_catalog`
- daily at `02:00`

`enrich-metadata-daily`
- `apps.animes.tasks.metadata.enrich_metadata`
- daily at `03:00`

`airing-workflow-cleanup-daily`
- `apps.animes.tasks.airing.sync_airing_workflow`
- daily at `04:00`

`update-relation-slugs-daily`
- `apps.animes.tasks.franchises.update_relation_slugs`
- daily at `04:30`
- added in this refactor because it is explicitly a repair task for stale relation data

`generate-recommendations-daily`
- `apps.animes.tasks.recommendations.generate_recommendations`
- daily at `05:00`

`sync-themes-daily`
- `apps.animes.tasks.themes.sync_theme_songs`
- daily at `06:00`

`user-maintenance-daily`
- `apps.users.tasks.run_user_maintenance_workflow`
- daily at `07:00`

`backfill-theme-youtube-urls-morning`
- `apps.animes.tasks.themes.backfill_theme_youtube_urls`
- daily at `08:30`

`backfill-theme-youtube-urls-evening`
- `apps.animes.tasks.themes.backfill_theme_youtube_urls`
- daily at `20:30`

`cleanup-old-notifications`
- `apps.core.tasks.notifications.cleanup_old_notifications_task`
- daily at `02:30`

`cleanup-task-results-daily`
- `apps.core.tasks.cleanup_tasks.cleanup_old_task_results`
- daily at `01:00`

`celery-backend-cleanup-daily`
- `celery.backend_cleanup`
- daily at `01:30`
- added in this refactor to clean `django-celery-results` rows using Celery’s standard backend cleanup flow

### Weekly

`sync-upcoming-weekly`
- `apps.animes.tasks.sync.sync_anime_catalog`
- Sunday at `03:30`

`sync-popular-weekly`
- `apps.animes.tasks.sync.sync_anime_catalog`
- Monday at `02:00`

### Other Existing Periodic Jobs

`sync-themes-retry`
- `apps.animes.tasks.themes.sync_theme_songs`
- daily at `18:00`

`check-new-episodes`
- `apps.core.tasks.notifications.check_new_episodes`
- every 6 hours

## Admin Setup

### Standard Result Backend

Persistent task result storage uses `django-celery-results`.

Required settings:

- `django_celery_results` in `INSTALLED_APPS`
- `CELERY_RESULT_BACKEND = "django-db"`
- `CELERY_RESULT_EXTENDED = True`

Run migrations in the normal deployment flow:

```bash
make mig
```

### Admin Views

Two task-history views are available in Django admin:

`core.CeleryTaskResult`
- Custom operational task history already used by the project.
- Now shows task name, status, date, and a result preview in the list view.

`django_celery_results.TaskResult`
- Standard backend-persisted result records from `django-celery-results`.
- Registered with a compact list view showing task name, status, completion time, and result preview.

## Operational Notes

- The shared `ObservedTask` base logs task start, retry, completion, and failure consistently.
- Long-running anime tasks still use `apps.animes.tasks.base.BaseTask`, which now inherits the shared observed task behavior.
- `apps.users.tasks.update_all_user_stats` now returns a serializable payload with the queued task id instead of returning a Celery object.
- The recommendation batch task delegates to `RecommendationService.generate_for_all_users()` to avoid repeated per-user lookup queries in the task layer.
