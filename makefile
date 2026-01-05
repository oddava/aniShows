.PHONY: help build up down restart logs web-logs front-logs celery-logs \
        mig migrate makemigrations shell superuser test collectstatic \
        msg icomp import_anime backfill_metadata remove_duplicates clean prune backup backups restore

# Service Management
up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

build:
	docker compose build

ps:
	docker compose ps

logs:
	docker compose logs -f

# Specific Service Logs
web-logs:
	docker compose logs -f web

front-logs:
	docker compose logs -f frontend

celery-logs:
	docker compose logs -f celery beat

# Django Commands
mig:
	docker compose exec web uv run python manage.py makemigrations
	docker compose exec web uv run python manage.py migrate

migrate:
	docker compose exec web uv run python manage.py migrate

makemigrations:
	docker compose exec web uv run python manage.py makemigrations

shell:
	docker compose exec web uv run python manage.py shell

superuser:
	docker compose exec web uv run python manage.py createsuperuser

test:
	docker compose exec web uv run python manage.py test

collectstatic:
	docker compose exec web uv run python manage.py collectstatic --noinput

# Translations
msg:
	docker compose exec web uv run python manage.py makemessages -l en -l uz

icomp:
	docker compose exec web uv run python manage.py compilemessages -i .venv

# Data Management
import_anime:
	docker compose exec web uv run python manage.py import_anime

backfill_metadata:
	docker compose exec web uv run python manage.py backfill_metadata

remove_duplicates:
	docker compose exec web uv run python manage.py remove_duplicate_lists

sync_trending:
	docker compose exec web uv run python manage.py shell -c "from anime.tasks import sync_trending_anime; sync_trending_anime.delay(limit=50)"

sync_seasonal:
	docker compose exec web uv run python manage.py shell -c "from anime.tasks import sync_seasonal_anime; sync_seasonal_anime.delay(limit=100)"

sync_upcoming:
	docker compose exec web uv run python manage.py shell -c "from anime.tasks import sync_next_season_anime; sync_next_season_anime.delay(limit=100)"

backfill_catalog:
	docker compose exec web uv run python manage.py shell -c "from anime.tasks import backfill_catalog; backfill_catalog.delay(start_page=1, pages=50)"

# Maintenance
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

prune:
	docker system prune -a --volumes -f

# Backups
backup:
	docker compose exec backup /app/shell/backup.sh manual

backups:
	docker compose exec backup ls -lh /backups

restore:
	@if [ -z "$(TIMESTAMP)" ]; then \
		echo "Error: TIMESTAMP is required. Usage: make restore TIMESTAMP=YYYYMMDD_HHMMSS"; \
		exit 1; \
	fi
	docker compose exec backup /app/shell/restore.sh $(TIMESTAMP)

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Service Management:"
	@echo "  up             Start services (detached)"
	@echo "  down           Stop services"
	@echo "  restart        Restart all services"
	@echo "  build          Build services"
	@echo "  ps             List running services"
	@echo "  logs           View global logs"
	@echo "  web-logs       View backend logs"
	@echo "  celery-logs    View worker/scheduler logs"
	@echo ""
	@echo "Django Commands:"
	@echo "  mig            Run makemigrations + migrate"
	@echo "  shell          Open Django shell"
	@echo "  superuser      Create superuser"
	@echo "  test           Run tests"
	@echo "  collectstatic  Collect static files"
	@echo ""
	@echo "Data Management:"
	@echo "  sync_trending  Sync currently airing anime"
	@echo "  sync_seasonal  Sync current season"
	@echo "  sync_upcoming  Sync next season (upcoming)"
	@echo "  import_anime   Run full import command"
	@echo "  backfill_metadata Backfill characters/staff"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean          Remove pyc/pycache files"
	@echo "  prune          Clean up unused Docker volumes/images"
	@echo ""
	@echo "Backups:"
	@echo "  backup         Trigger manual backup"
	@echo "  backups        List available backups"
	@echo "  restore        Restore backup (Usage: make restore TIMESTAMP=...)"