# ============================================================================
# aniShows Makefile
# ============================================================================

EXEC = docker compose exec web python manage.py

.PHONY: help up down restart build ps logs web-logs celery-logs celery-priority-logs \
        celery-images-logs celery-analytics-logs beat-logs \
        front-logs db-logs mig migrate shell superuser test lint collectstatic \
        msg icomp import-anime sync-catalog sync-airing sync-metadata \
        sync-themes sync-full sync-franchises sync-recs import-offline \
        import-offline-async import-offline-resume import-offline-full populate-themes \
        backfill-urls backfill-youtube update-slugs thumbnails thumbnails-s3 \
        backfill-points user-stats remove-duplicates fix-counters seed-forums \
        clean prune cleanup-media backup backups backup-export backup-import exports \
        verify-backup restore restore-db-only restore-media-only load-browse

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

migrate:                        ## Run migrate only (safe for runtime/startup)
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
	$(EXEC) migrate
	$(EXEC) sync_anime sync-catalog --async

sync-airing:                    ## Sync airing schedule + backfill dates
	$(EXEC) migrate
	$(EXEC) sync_anime sync-airing --async

sync-metadata:                  ## Enrich anime metadata
	$(EXEC) migrate
	$(EXEC) sync_anime enrich-metadata --async

sync-themes:                    ## Sync theme songs via Celery
	$(EXEC) migrate
	$(EXEC) sync_anime sync-themes --async

sync-recs:                      ## Generate recommendations for all users
	$(EXEC) migrate
	$(EXEC) sync_anime generate-recommendations --async

sync-full:                      ## Run full sync pipeline (catalog + airing + metadata + themes + recs)
	$(EXEC) migrate
	$(EXEC) sync_anime full-sync --async

import-offline:                 ## Import Anime Offline Database (sync). Override RELEASE=..., IMPORT_LIMIT=..., SOURCE_PATH=...
	$(EXEC) migrate
	$(EXEC) sync_anime import-offline-catalog --release-tag $${RELEASE:-latest} \
		$(if $(IMPORT_LIMIT),--import-limit $(IMPORT_LIMIT),) \
		$(if $(SOURCE_PATH),--source-path $(SOURCE_PATH),) \
		$(if $(SOURCE_URL),--source-url $(SOURCE_URL),)

import-offline-async:           ## Queue Anime Offline Database import. Override RELEASE=..., IMPORT_LIMIT=..., SOURCE_PATH=...
	$(EXEC) migrate
	$(EXEC) sync_anime import-offline-catalog --release-tag $${RELEASE:-latest} --async --queue batch \
		$(if $(IMPORT_LIMIT),--import-limit $(IMPORT_LIMIT),) \
		$(if $(SOURCE_PATH),--source-path $(SOURCE_PATH),) \
		$(if $(SOURCE_URL),--source-url $(SOURCE_URL),)

import-offline-resume:          ## Resume latest incomplete Anime Offline Database import
	$(EXEC) migrate
	$(EXEC) sync_anime import-offline-catalog --release-tag $${RELEASE:-latest} --resume \
		$(if $(IMPORT_LIMIT),--import-limit $(IMPORT_LIMIT),) \
		$(if $(SOURCE_PATH),--source-path $(SOURCE_PATH),) \
		$(if $(SOURCE_URL),--source-url $(SOURCE_URL),)

import-offline-full:            ## Import Anime Offline Database and queue enrichment jobs
	$(EXEC) migrate
	$(EXEC) sync_anime import-offline-catalog --release-tag $${RELEASE:-latest} --enqueue-enrichment \
		$(if $(IMPORT_LIMIT),--import-limit $(IMPORT_LIMIT),) \
		$(if $(SOURCE_PATH),--source-path $(SOURCE_PATH),) \
		$(if $(SOURCE_URL),--source-url $(SOURCE_URL),) \
		$(if $(ENRICHMENT_CHUNK_SIZE),--enrichment-chunk-size $(ENRICHMENT_CHUNK_SIZE),)

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

cleanup-media:                  ## Clear missing anime media refs (add QUEUE=1 to re-fetch)
	$(EXEC) cleanup_anime_media $(if $(QUEUE),--queue-fetch,) $(if $(LIMIT),--limit $(LIMIT),)

prune:                          ## Docker system prune (removes all unused data)
	docker system prune -a --volumes -f

load-browse:                    ## Run read-heavy k6 browse load profile (set BASE_URL=...)
	docker run --rm -i \
		-e BASE_URL=$${BASE_URL:-http://localhost} \
		-v $(PWD)/monitoring/load-tests:/load-tests \
		grafana/k6 run /load-tests/k6-browse.js

# ============================================================================
# Backups
# ============================================================================

backup:                         ## Trigger manual database backup
	docker compose exec backup /app/shell/backup.sh manual

backups:                        ## List available backups with metadata
	docker compose exec backup /app/shell/list.sh

backup-export:                  ## Export backup as portable bundle (Usage: make backup-export TIMESTAMP=... [NAME=file.tar.gz])
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make backup-export TIMESTAMP=YYYYMMDD_HHMMSS (or full backup dir)"; \
		exit 1; \
	fi
	docker compose exec -e EXPORT_NAME="$(NAME)" backup /app/shell/export.sh $(TIMESTAMP)

exports:                        ## List portable backup bundles
	docker compose exec backup sh -lc 'ls -lh /backups/exports 2>/dev/null || echo "No exports found."'

backup-import:                  ## Import portable bundle (Usage: make backup-import FILE=your-backup.portable.tar.gz)
	@if [ -z "$(FILE)" ]; then \
		echo "Error: FILE is required. Usage: make backup-import FILE=your-backup.portable.tar.gz"; \
		exit 1; \
	fi
	docker compose exec backup /app/shell/import.sh $(FILE)

verify-backup:                  ## Validate backup integrity + test restore (Usage: make verify-backup TIMESTAMP=...)
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make verify-backup TIMESTAMP=YYYYMMDD_HHMMSS (or full backup dir)"; \
		exit 1; \
	fi
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP) --check

restore:                        ## Safe full restore (Usage: make restore TIMESTAMP=... FORCE=1)
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make restore TIMESTAMP=YYYYMMDD_HHMMSS (or full backup dir) FORCE=1"; \
		exit 1; \
	fi
	@if [ "$(FORCE)" != "1" ]; then \
		echo "Error: Restore is destructive. Re-run with FORCE=1 after verifying the backup."; \
		echo "Tip: make verify-backup TIMESTAMP=$(TIMESTAMP)"; \
		exit 1; \
	fi
	@services="pgbouncer web daphne celery celery_priority celery_images celery_analytics beat minio"; \
	set -e; \
	echo "Stopping app services for restore: $$services"; \
	docker compose stop $$services; \
	restore_status=0; \
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP) --yes || restore_status=$$?; \
	echo "Starting app services: $$services"; \
	docker compose start $$services; \
	if [ $$restore_status -ne 0 ]; then \
		echo "Restore failed. Services were started back up."; \
		exit $$restore_status; \
	fi
	docker compose exec web python manage.py migrate --noinput

restore-db-only:                ## Restore DB only (Usage: make restore-db-only TIMESTAMP=... FORCE=1)
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make restore-db-only TIMESTAMP=... FORCE=1"; \
		exit 1; \
	fi
	@if [ "$(FORCE)" != "1" ]; then \
		echo "Error: Restore is destructive. Re-run with FORCE=1."; \
		exit 1; \
	fi
	@services="pgbouncer web daphne celery celery_priority celery_images celery_analytics beat"; \
	set -e; \
	docker compose stop $$services; \
	restore_status=0; \
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP) --yes --skip-media || restore_status=$$?; \
	docker compose start $$services; \
	if [ $$restore_status -ne 0 ]; then exit $$restore_status; fi
	docker compose exec web python manage.py migrate --noinput

restore-media-only:             ## Restore media only (Usage: make restore-media-only TIMESTAMP=... FORCE=1)
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make restore-media-only TIMESTAMP=... FORCE=1"; \
		exit 1; \
	fi
	@if [ "$(FORCE)" != "1" ]; then \
		echo "Error: Restore is destructive. Re-run with FORCE=1."; \
		exit 1; \
	fi
	@services="minio"; \
	set -e; \
	docker compose stop $$services; \
	restore_status=0; \
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP) --yes --skip-db || restore_status=$$?; \
	docker compose start $$services; \
	if [ $$restore_status -ne 0 ]; then exit $$restore_status; fi

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
