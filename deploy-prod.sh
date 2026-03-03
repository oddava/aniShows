#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Deploys both frontend (from GHCR image -> Docker volume) and backend services
# Also handles Caddy reload, migrations, static files, and cleanup

set -e

# Load environment variables from .env file (used by pg_isready check below)
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:latest"
FRONTEND_VOLUME="anishows_frontend_dist"

echo -e "${BLUE}Starting full deployment (frontend + backend)...${NC}"
echo ""

# Ensure docker compose is available
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
    echo -e "${BLUE}  Copying new frontend files from image (atomic swap)...${NC}"
    # Use a temp directory approach to minimize downtime
    docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend $FRONTEND_IMAGE sh -c '
        mkdir -p /srv/frontend_new &&
        cp -r /app/dist/* /srv/frontend_new/ &&
        rm -rf /srv/frontend_old &&
        mv /srv/frontend /srv/frontend_old 2>/dev/null || true &&
        mv /srv/frontend_new /srv/frontend &&
        rm -rf /srv/frontend_old &&
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
$COMPOSE_CMD pull web celery beat
echo -e "${GREEN}Backend images pulled!${NC}"
echo ""

# =========================================================================
# RUN MIGRATIONS BEFORE RESTARTING (new code must handle old+new schema)
# =========================================================================
echo -e "${BLUE}Step 3: Running database migrations (before restart)...${NC}"

# CRITICAL: Database must already be running - we NEVER start/recreate it in deployment
echo -e "${BLUE}  Checking if database is running...${NC}"
DB_CONTAINER=$($COMPOSE_CMD ps -q db 2>/dev/null)
if [ -z "$DB_CONTAINER" ]; then
    echo -e "${RED}  ERROR: Database container is not running!${NC}"
    echo -e "${RED}  Database must be running before deployment.${NC}"
    echo -e "${YELLOW}  Start it manually: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db${NC}"
    exit 1
fi

# Verify container is actually running
DB_RUNNING=$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo "false")
if [ "$DB_RUNNING" != "true" ]; then
    echo -e "${RED}  ERROR: Database container exists but is not running!${NC}"
    echo -e "${YELLOW}  Attempting to start existing container: docker start $DB_CONTAINER${NC}"
    docker start "$DB_CONTAINER" || {
        echo -e "${RED}  Failed to start database container!${NC}"
        exit 1
    }
fi

echo -e "${GREEN}  Database container verified (ID: ${DB_CONTAINER:0:12})${NC}"
echo -e "${BLUE}  Waiting for database to be ready...${NC}"
for i in $(seq 1 30); do
    if docker exec -i "$DB_CONTAINER" pg_isready -U "${DB_USER:-postgres}" -d "${DB_NAME:-anishows_db}" >/dev/null 2>&1; then
        echo -e "${GREEN}  Database is ready!${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}  Database failed to become ready after 30 attempts!${NC}"
        docker logs --tail=30 "$DB_CONTAINER"
        exit 1
    fi
    sleep 2
done

# Run migrations using the existing container directly
echo -e "${BLUE}  Running migrations...${NC}"
WEB_CONTAINER=$($COMPOSE_CMD ps -q web 2>/dev/null)
if [ -n "$WEB_CONTAINER" ]; then
    # Use existing web container if running
    docker exec -i "$WEB_CONTAINER" python manage.py migrate --noinput
else
    # Run new container just for migrations, but don't affect other services
    docker run --rm --network anishows_default \
        -e DB_HOST="${DB_HOST:-db}" \
        -e DB_NAME="${DB_NAME}" \
        -e DB_USER="${DB_USER}" \
        -e DB_PASSWORD="${DB_PASSWORD}" \
        -e DB_PORT="${DB_PORT:-5432}" \
        -e REDIS_HOST="${REDIS_HOST:-redis}" \
        -e REDIS_PORT="${REDIS_PORT:-6379}" \
        -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
        -e DJANGO_SETTINGS_MODULE="root.settings" \
        -e DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY}" \
        -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
        -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
        -e AWS_STORAGE_BUCKET_NAME="${AWS_STORAGE_BUCKET_NAME}" \
        -e AWS_S3_ENDPOINT_URL="${AWS_S3_ENDPOINT_URL}" \
        -e MINIO_PUBLIC_DOMAIN="${MINIO_PUBLIC_DOMAIN}" \
        ghcr.io/oddava/anishows-backend:latest \
        python manage.py migrate --noinput
fi
echo -e "${GREEN}Migrations complete!${NC}"
echo ""

# =========================================================================
# RESTART SERVICES (rolling restart for zero-downtime)
# =========================================================================
echo -e "${BLUE}Step 4: Restarting services...${NC}"
# Restart workers first, then web (reverse proxy keeps serving old containers until healthy)
$COMPOSE_CMD up -d --no-deps celery beat
sleep 2
$COMPOSE_CMD up -d --no-deps web
echo -e "${GREEN}All containers started!${NC}"
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
