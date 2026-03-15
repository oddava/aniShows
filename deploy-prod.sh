#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Deploys both frontend (from GHCR image -> Docker volume) and backend services
# Also handles Caddy reload, migrations, static files, and cleanup

set -e

if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:latest"
FRONTEND_VOLUME="anishows_frontend_dist"
SCALE_WEB="${SCALE_WEB:-2}"
SCALE_DAPHNE="${SCALE_DAPHNE:-2}"
SCALE_CELERY="${SCALE_CELERY:-2}"
SCALE_CELERY_PRIORITY="${SCALE_CELERY_PRIORITY:-2}"
SCALE_CELERY_IMAGES="${SCALE_CELERY_IMAGES:-1}"
SCALE_CELERY_ANALYTICS="${SCALE_CELERY_ANALYTICS:-1}"

echo -e "${BLUE}Starting full deployment (frontend + backend)...${NC}"
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi

# =========================================================================
# FRONTEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}Step 1: Deploying frontend...${NC}"

echo -e "${BLUE}  Pulling latest frontend image from GHCR...${NC}"
if docker pull $FRONTEND_IMAGE; then
    echo -e "${GREEN}  Frontend image pulled!${NC}"
else
    echo -e "${YELLOW}  Failed to pull frontend image (may need: docker login ghcr.io)${NC}"
    echo -e "${YELLOW}  Skipping frontend deployment, continuing with backend...${NC}"
    SKIP_FRONTEND=true
fi

if [ "$SKIP_FRONTEND" != "true" ]; then
    echo -e "${BLUE}  Deploying new frontend files...${NC}"
    # Clean out old files and copy new ones
    docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend $FRONTEND_IMAGE sh -c '
        rm -rf /srv/frontend/* &&
        cp -r /app/dist/* /srv/frontend/ &&
        echo DONE
    '

    echo -e "${BLUE}  Verifying frontend assets...${NC}"
    if docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend alpine:latest test -f /srv/frontend/index.html; then
        echo -e "${GREEN}  Frontend deployed successfully!${NC}"
    else
        echo -e "${RED}  Frontend deployment failed - index.html not found!${NC}"
    fi
fi
echo ""

# =========================================================================
# BACKEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}Step 2: Pulling latest backend images from GHCR...${NC}"
$COMPOSE_CMD pull web celery celery_priority celery_images celery_analytics beat daphne
echo -e "${GREEN}Backend images pulled!${NC}"
echo ""

# =========================================================================
# RUN MIGRATIONS BEFORE RESTARTING (new code must handle old+new schema)
# =========================================================================
echo -e "${BLUE}Step 3: Running database migrations (before restart)...${NC}"
# Ensure DB, PgBouncer, and Redis are up before running migrations
$COMPOSE_CMD up -d --no-deps db redis
echo -e "${BLUE}  Waiting for database to be ready...${NC}"
for i in $(seq 1 30); do
    if $COMPOSE_CMD exec -T db pg_isready -U "${DB_USER:-postgres}" -d "${DB_NAME:-anishows_db}" >/dev/null 2>&1; then
        echo -e "${GREEN}  Database is ready!${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}  Database failed to become ready after 30 attempts!${NC}"
        $COMPOSE_CMD logs --tail=20 db
        exit 1
    fi
    sleep 2
done

# Run migrations using compose run with --no-deps to avoid recreating other services
$COMPOSE_CMD run --rm --no-deps -e DB_USE_PGBOUNCER=False -e DB_HOST="${PGBOUNCER_DB_HOST:-db}" -e DB_PORT="5432" web python manage.py migrate --noinput
echo -e "${GREEN}Migrations complete!${NC}"
echo ""

# Start PgBouncer now that DB is ready (web and workers connect through it)
$COMPOSE_CMD up -d --no-deps pgbouncer
echo -e "${BLUE}  Waiting for PgBouncer to be healthy...${NC}"
for i in $(seq 1 15); do
    if $COMPOSE_CMD exec -T pgbouncer pg_isready -h localhost -p "${DB_PGBOUNCER_PORT:-6432}" -U "${DB_USER:-postgres}" >/dev/null 2>&1; then
        echo -e "${GREEN}  PgBouncer is ready!${NC}"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo -e "${RED}  PgBouncer failed to become ready after 15 attempts!${NC}"
        $COMPOSE_CMD logs --tail=20 pgbouncer
        exit 1
    fi
    sleep 2
done
echo ""

# =========================================================================
# RESTART SERVICES (rolling restart for zero-downtime)
# =========================================================================
echo -e "${BLUE}Step 4: Restarting services...${NC}"
# Restart workers first, then web (reverse proxy keeps serving old containers until healthy)
$COMPOSE_CMD up -d --no-deps \
  --scale celery=$SCALE_CELERY \
  --scale celery_priority=$SCALE_CELERY_PRIORITY \
  --scale celery_images=$SCALE_CELERY_IMAGES \
  --scale celery_analytics=$SCALE_CELERY_ANALYTICS \
  celery celery_priority celery_images celery_analytics beat
sleep 2
$COMPOSE_CMD up -d --no-deps \
  --scale web=$SCALE_WEB \
  --scale daphne=$SCALE_DAPHNE \
  web daphne
echo -e "${GREEN}All containers started!${NC}"
echo -e "${BLUE}  Scale profile: web=$SCALE_WEB daphne=$SCALE_DAPHNE celery=$SCALE_CELERY celery_priority=$SCALE_CELERY_PRIORITY celery_images=$SCALE_CELERY_IMAGES celery_analytics=$SCALE_CELERY_ANALYTICS${NC}"
echo ""

# =========================================================================
# CLEAR APPLICATION CACHE (not broker data)
# =========================================================================
echo -e "${BLUE}Step 5: Clearing application cache...${NC}"
# Use Django's cache.clear() via management shell instead of FLUSHALL
# This only clears the cache, preserving Celery broker state and pending tasks
if $COMPOSE_CMD exec -T web python -c "
from django.core.cache import cache
cache.clear()
print('Cache cleared successfully')
" 2>/dev/null; then
    echo -e "${GREEN}Application cache cleared!${NC}"
else
    echo -e "${YELLOW}Cache clear warning (service may still be starting)${NC}"
fi
echo ""

echo -e "${BLUE}Step 6: Reloading Caddy...${NC}"
sleep 2
if $COMPOSE_CMD exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force; then
    echo -e "${GREEN}Caddy reloaded successfully!${NC}"
else
    echo -e "${YELLOW}Caddy reload warning (may already be up to date)${NC}"
fi
echo ""

# =========================================================================
# HEALTH CHECK
# =========================================================================
echo -e "${BLUE}Step 7: Verifying deployment health...${NC}"
sleep 5
HEALTH_OK=false
for i in 1 2 3; do
    if $COMPOSE_CMD exec -T web python -c "
import urllib.request
response = urllib.request.urlopen('http://localhost:8000/api/v1/health/', timeout=5)
print(response.read().decode())
" 2>/dev/null; then
        HEALTH_OK=true
        break
    fi
    echo -e "${YELLOW}  Health check attempt $i failed, retrying in 5s...${NC}"
    sleep 5
done

if [ "$HEALTH_OK" = true ]; then
    echo -e "${GREEN}Health check passed!${NC}"
else
    echo -e "${RED}Health check failed after 3 attempts!${NC}"
    echo -e "${YELLOW}Checking container logs...${NC}"
    $COMPOSE_CMD logs --tail=20 web
fi
echo ""

echo -e "${BLUE}Step 8: Pruning old images...${NC}"
docker image prune -f --filter "until=24h" --filter "label=org.opencontainers.image.source=https://github.com/oddava/anishows"
echo -e "${GREEN}Old images pruned!${NC}"
echo ""

echo -e "${GREEN}Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}Services status:${NC}"
$COMPOSE_CMD ps

echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo -e "   ${BLUE}View logs:${NC} $COMPOSE_CMD logs -f web"
echo -e "   ${BLUE}View all logs:${NC} $COMPOSE_CMD logs -f"
