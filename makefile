# ============================================================================
# aniShows Makefile
# ============================================================================

EXEC = docker compose exec web python manage.py

.PHONY: help up down restart build ps logs web-logs celery-logs celery-priority-logs \
        celery-images-logs celery-analytics-logs beat-logs \
        front-logs db-logs mig shell superuser test lint collectstatic \
        msg icomp import-anime sync-catalog sync-airing sync-metadata \
        sync-themes sync-full sync-franchises sync-recs populate-themes \
        backfill-urls backfill-youtube update-slugs thumbnails thumbnails-s3 \
        backfill-points user-stats remove-duplicates fix-counters seed-forums \
        clean prune backup backups restore

# ============================================================================
# Service Management
# ============================================================================

up:                             ## Start all services (detached)
	docker compose up -d

down:                           ## Stop all services
	docker compose down

restart:                        ## Restart all services
	docker compose restart

build:                          ## Rebuild all Docker images
	docker compose build

ps:                             ## List running services
	docker compose ps

# ============================================================================
# Logs
# ============================================================================

logs:                           ## Follow all logs
	docker compose logs -f

web-logs:                       ## Follow web server logs
	docker compose logs -f web

celery-logs:                    ## Follow Celery worker logs
	docker compose logs -f celery

celery-priority-logs:           ## Follow Celery priority worker logs
	docker compose logs -f celery_priority

celery-images-logs:             ## Follow Celery images worker logs
	docker compose logs -f celery_images

celery-analytics-logs:          ## Follow Celery analytics worker logs
	docker compose logs -f celery_analytics

beat-logs:                      ## Follow Celery beat logs
	docker compose logs -f beat

front-logs:                     ## Follow frontend logs
	docker compose logs -f frontend

db-logs:                        ## Follow database logs
	docker compose logs -f db

# ============================================================================
# Django Core
# ============================================================================

mig:                            ## Run makemigrations + migrate
	$(EXEC) makemigrations
	$(EXEC) migrate

shell:                          ## Open Django shell
	$(EXEC) shell

superuser:                      ## Create superuser
	$(EXEC) createsuperuser

test:                           ## Run tests
	$(EXEC) test

lint:                           ## Run linter (ruff)
	docker compose exec web uv run ruff check .

collectstatic:                  ## Collect static files
	$(EXEC) collectstatic --noinput

# ============================================================================
# Translations
# ============================================================================

msg:                            ## Extract translatable messages (en/uz)
	$(EXEC) makemessages -l en -l uz

icomp:                          ## Compile message translations
	$(EXEC) compilemessages -i .venv

# ============================================================================
# Anime Sync (unified via sync_anime command)
# ============================================================================

sync-catalog:                   ## Sync anime catalog from AniList (--sync-type=trending)
	$(EXEC) sync_anime sync-catalog --async

sync-airing:                    ## Sync airing schedule + backfill dates
	$(EXEC) sync_anime sync-airing --async

sync-metadata:                  ## Enrich anime metadata
	$(EXEC) sync_anime enrich-metadata --async

sync-themes:                    ## Sync theme songs via Celery
	$(EXEC) sync_anime sync-themes --async

sync-recs:                      ## Generate recommendations for all users
	$(EXEC) sync_anime generate-recommendations --async

sync-full:                      ## Run full sync pipeline (catalog + airing + metadata + themes + recs)
	$(EXEC) sync_anime full-sync --async

## ============================================================================
## Data Population & Backfill
## ============================================================================
#
#populate-themes:                ## Fetch themes directly from Jikan API (standalone, no Celery)
#	$(EXEC) populate_themes
#
#sync-franchises:                ## Populate franchise/relation data from AniList
#	$(EXEC) populate_franchises
#
#backfill-urls:                  ## Backfill external image URLs from AniList
#	$(EXEC) backfill_external_urls
#
#backfill-youtube:               ## Generate YouTube URLs for theme songs
#	$(EXEC) backfill_theme_youtube
#
#update-slugs:                   ## Fix missing slugs on anime relations
#	$(EXEC) update_relation_slugs
#
#thumbnails:                     ## Pre-generate all ImageKit thumbnails
#	$(EXEC) generate_thumbnails
#
#thumbnails-s3:                  ## Copy local thumbnails to MinIO/S3
#	$(EXEC) copy_thumbnails_to_s3
#

# ============================================================================
# Forums
# ============================================================================

seed-forums:                    ## Seed forum categories and tags
	$(EXEC) seed_forums

# ============================================================================
# Maintenance
# ============================================================================

clean:                          ## Remove .pyc and __pycache__ files
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

prune:                          ## Docker system prune (removes all unused data)
	docker system prune -a --volumes -f

# ============================================================================
# Backups
# ============================================================================

backup:                         ## Trigger manual database backup
	docker compose exec backup /app/shell/backup.sh manual

backups:                        ## List available backups
	docker compose exec backup ls -lh /backups

restore:                        ## Restore from backup (Usage: make restore TIMESTAMP=YYYYMMDD_HHMMSS)
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make restore TIMESTAMP=YYYYMMDD_HHMMSS"; \
		exit 1; \
	fi
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP)

# ============================================================================
# Help
# ============================================================================

help:                           ## Show this help
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
