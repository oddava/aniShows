.PHONY: help build up down restart logs web-logs front-logs celery-logs \
        mig migrate makemigrations shell superuser test collectstatic \
        msg icomp import_anime clean prune backup backups restore

# Docker Compose commands
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

# Django commands
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

# Translation commands
msg:
	docker compose exec web uv run python manage.py makemessages -l en -l uz

icomp:
	docker compose exec web uv run python manage.py compilemessages -i .venv

# App specific
import_anime:
	docker compose exec web uv run python manage.py import_anime

# Cleanup
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

prune:
	docker system prune -a --volumes -f

# -----------------------------------------------------------------------------
# Backups
# -----------------------------------------------------------------------------

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
	@echo "Docker Lifecycle:"
	@echo "  up             Start services in background"
	@echo "  down           Stop services"
	@echo "  restart        Restart all services"
	@echo "  build          Build or rebuild services"
	@echo "  ps             List containers"
	@echo "  logs           Follow all logs"
	@echo ""
	@echo "Service Logs:"
	@echo "  web-logs       Follow Django logs"
	@echo "  front-logs     Follow Frontend logs"
	@echo "  celery-logs    Follow Celery/Beat logs"
	@echo ""
	@echo "Django Shortcuts:"
	@echo "  mig            Make and apply migrations"
	@echo "  migrate        Apply migrations"
	@echo "  makemigrations Create new migrations"
	@echo "  shell          Open Django shell"
	@echo "  superuser      Create a superuser"
	@echo "  test           Run tests"
	@echo "  collectstatic  Collect static files"
	@echo ""
	@echo "Translations:"
	@echo "  msg            Extract messages (en, uz)"
	@echo "  icomp          Compile messages"
	@echo ""
	@echo "Misc:"
	@echo "  import_anime   Import anime data"
	@echo "  clean          Remove python cache files"
	@echo "  prune           Remove all stopped containers and unused images"
	@echo "  backup          Trigger a manual backup"
	@echo "  backups         List all available backups"
	@echo "  restore         Restore from a backup (Usage: make restore TIMESTAMP=YYYYMMDD_HHMMSS)"