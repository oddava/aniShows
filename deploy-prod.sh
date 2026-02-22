#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Fixed frontend caching issues - now reloads Caddy to clear internal cache

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo -e "${BLUE}🚀 Starting registry-based deployment...${NC}"
echo ""

# Ensure docker compose is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Step 1: Pulling latest images from GHCR...${NC}"
$COMPOSE_CMD pull
echo -e "${GREEN}✅ Images pulled successfully!${NC}"
echo ""

echo -e "${BLUE}🚀 Step 2: Clearing old frontend assets...${NC}"
# Clear old frontend assets to prevent stale file accumulation (safe - only affects frontend build files)
docker run --rm -v anishows_frontend_dist:/srv/frontend alpine:latest sh -c "rm -rf /srv/frontend/assets/* /srv/frontend/sw.js /srv/frontend/workbox-*.js 2>/dev/null || true" 2>/dev/null || echo -e "${YELLOW}⚠️  Could not clear frontend volume (may not exist yet)${NC}"
echo -e "${GREEN}✅ Old frontend assets cleared!${NC}"
echo ""

echo -e "${BLUE}🚀 Step 3: Restarting containers...${NC}"
$COMPOSE_CMD up -d
echo -e "${GREEN}✅ Containers restarted!${NC}"
echo ""

echo -e "${BLUE}🔄 Step 4: Reloading Caddy to clear cache...${NC}"
sleep 2 # Wait for frontend init to complete
if $COMPOSE_CMD exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force; then
    echo -e "${GREEN}✅ Caddy reloaded successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Caddy reload warning (may already be up to date)${NC}"
fi
echo ""

echo -e "${BLUE}🔄 Step 5: Running database migrations...${NC}"
sleep 3 # Wait for containers to start
if $COMPOSE_CMD exec -T web uv run python manage.py migrate --noinput; then
    echo -e "${GREEN}✅ Migrations complete!${NC}"
else
    echo -e "${YELLOW}⚠️  Migration warning (may be already applied)${NC}"
fi
echo ""

echo -e "${BLUE}🎨 Step 6: Collecting static files...${NC}"
# Fix permissions for static directory
mkdir -p static
docker run --rm -v "$(pwd)/static:/static" alpine:latest chown -R 1000:1000 /static 2>/dev/null || true

if $COMPOSE_CMD exec -T web uv run python manage.py collectstatic --noinput --clear; then
    echo -e "${GREEN}✅ Static files collected!${NC}"
else
    echo -e "${RED}❌ Failed to collect static files!${NC}"
fi
echo ""

echo -e "${BLUE}🧹 Step 7: Pruning old images...${NC}"
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
