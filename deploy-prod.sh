#!/bin/bash
#
# Production deployment script for anishows using GHCR
# Frontend deployment is handled by the CI deploy step (direct docker pull by SHA)
# This script handles backend services, Caddy, migrations, and static files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo -e "${BLUE}🚀 Starting backend deployment...${NC}"
echo ""

# Ensure docker compose is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Step 1: Pulling latest backend images from GHCR...${NC}"
$COMPOSE_CMD pull web celery beat
echo -e "${GREEN}✅ Backend images pulled!${NC}"
echo ""

echo -e "${BLUE}🚀 Step 2: Restarting backend services...${NC}"
$COMPOSE_CMD up -d
echo -e "${GREEN}✅ All containers started!${NC}"
echo ""

echo -e "${BLUE}🔄 Step 3: Reloading Caddy...${NC}"
sleep 2
if $COMPOSE_CMD exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force; then
    echo -e "${GREEN}✅ Caddy reloaded successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Caddy reload warning (may already be up to date)${NC}"
fi
echo ""

echo -e "${BLUE}🔄 Step 4: Running database migrations...${NC}"
sleep 3
if $COMPOSE_CMD exec -T web uv run python manage.py migrate --noinput; then
    echo -e "${GREEN}✅ Migrations complete!${NC}"
else
    echo -e "${YELLOW}⚠️  Migration warning (may be already applied)${NC}"
fi
echo ""

echo -e "${BLUE}🎨 Step 5: Collecting static files...${NC}"
mkdir -p static
docker run --rm -v "$(pwd)/static:/static" alpine:latest chown -R 1000:1000 /static 2>/dev/null || true

if $COMPOSE_CMD exec -T web uv run python manage.py collectstatic --noinput --clear; then
    echo -e "${GREEN}✅ Static files collected!${NC}"
else
    echo -e "${RED}❌ Failed to collect static files!${NC}"
fi
echo ""

echo -e "${BLUE}🧹 Step 6: Pruning old images...${NC}"
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