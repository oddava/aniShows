#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Deploys both frontend (from GHCR image → Docker volume) and backend services
# Also handles Caddy reload, migrations, static files, and cleanup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
FRONTEND_IMAGE="ghcr.io/oddava/anishows-frontend:latest"
FRONTEND_VOLUME="anishows_frontend_dist"

echo -e "${BLUE}🚀 Starting full deployment (frontend + backend)...${NC}"
echo ""

# Ensure docker compose is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

# =========================================================================
# FRONTEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}🎨 Step 1: Deploying frontend...${NC}"

echo -e "${BLUE}  📦 Pulling latest frontend image from GHCR...${NC}"
if docker pull $FRONTEND_IMAGE; then
    echo -e "${GREEN}  ✅ Frontend image pulled!${NC}"
else
    echo -e "${YELLOW}  ⚠️  Failed to pull frontend image (may need: docker login ghcr.io)${NC}"
    echo -e "${YELLOW}  ⚠️  Skipping frontend deployment, continuing with backend...${NC}"
    SKIP_FRONTEND=true
fi

if [ "$SKIP_FRONTEND" != "true" ]; then
    echo -e "${BLUE}  🧹 Wiping old frontend assets...${NC}"
    docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend alpine:latest sh -c 'rm -rf /srv/frontend/*'

    echo -e "${BLUE}  📋 Copying new frontend files from image...${NC}"
    docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend $FRONTEND_IMAGE sh -c 'cp -r /app/dist/* /srv/frontend/ && echo DONE'

    echo -e "${BLUE}  🔍 Verifying frontend assets...${NC}"
    if docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend alpine:latest test -f /srv/frontend/index.html; then
        echo -e "${GREEN}  ✅ Frontend deployed successfully!${NC}"
        docker run --rm -v ${FRONTEND_VOLUME}:/srv/frontend alpine:latest ls -la /srv/frontend/
    else
        echo -e "${RED}  ❌ Frontend deployment failed - index.html not found!${NC}"
    fi
fi
echo ""

# =========================================================================
# BACKEND DEPLOYMENT
# =========================================================================
echo -e "${BLUE}📦 Step 2: Pulling latest backend images from GHCR...${NC}"
$COMPOSE_CMD pull web celery beat
echo -e "${GREEN}✅ Backend images pulled!${NC}"
echo ""

echo -e "${BLUE}🚀 Step 3: Restarting all services...${NC}"
$COMPOSE_CMD up -d
echo -e "${GREEN}✅ All containers started!${NC}"
echo ""

echo -e "${BLUE}🧹 Step 4: Clearing Redis cache...${NC}"
sleep 2
if $COMPOSE_CMD exec -T redis redis-cli FLUSHALL; then
    echo -e "${GREEN}✅ Redis cache cleared!${NC}"
else
    echo -e "${YELLOW}⚠️  Redis cache clear warning (may be already empty)${NC}"
fi
echo ""

echo -e "${BLUE}🔄 Step 5: Reloading Caddy...${NC}"
sleep 2
if $COMPOSE_CMD exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force; then
    echo -e "${GREEN}✅ Caddy reloaded successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Caddy reload warning (may already be up to date)${NC}"
fi
echo ""

echo -e "${BLUE}🔄 Step 6: Running database migrations...${NC}"
sleep 3
if $COMPOSE_CMD exec -T web uv run python manage.py migrate --noinput; then
    echo -e "${GREEN}✅ Migrations complete!${NC}"
else
    echo -e "${YELLOW}⚠️  Migration warning (may be already applied)${NC}"
fi
echo ""

echo -e "${BLUE}🎨 Step 7: Collecting static files...${NC}"
mkdir -p static
docker run --rm -v "$(pwd)/static:/static" alpine:latest chown -R 1000:1000 /static 2>/dev/null || true

if $COMPOSE_CMD exec -T web uv run python manage.py collectstatic --noinput --clear; then
    echo -e "${GREEN}✅ Static files collected!${NC}"
else
    echo -e "${RED}❌ Failed to collect static files!${NC}"
fi
echo ""

echo -e "${BLUE}🧹 Step 8: Pruning old images...${NC}"
docker image prune -a -f --filter "until=24h"
echo -e "${GREEN}✅ Old images pruned!${NC}"
echo ""

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Services status:${NC}"
$COMPOSE_CMD ps

echo ""
echo -e "${BLUE}📝 Useful commands:${NC}"
echo -e "   ${BLUE}View logs:${NC} $COMPOSE_CMD logs -f web"
echo -e "   ${BLUE}View all logs:${NC} $COMPOSE_CMD logs -f"