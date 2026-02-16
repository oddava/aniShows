#!/bin/bash
#
# Production deployment script for anishows
# Supports multiple deployment modes for faster updates
#
# Usage:
#   ./deploy-prod.sh [mode]
#
# Modes:
#   quick       - Fast restart (no rebuild, for code-only changes)
#   frontend    - Rebuild frontend only (React changes)
#   backend     - Rebuild backend only (Django/Python changes + deps)
#   full        - Full rebuild (everything, slowest)
#   auto        - Detect changes and rebuild only what's needed (default)
#
# Examples:
#   ./deploy-prod.sh quick      # Fast restart for small code changes
#   ./deploy-prod.sh frontend   # Only rebuild React app
#   ./deploy-prod.sh backend    # Only rebuild Python/Django
#   ./deploy-prod.sh full       # Complete rebuild (Dockerfile changes)
#

set -e

# Default mode
MODE="${1:-auto}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if git is available
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git is not installed${NC}"
    exit 1
fi

# Get the last deployed commit (stored in a file)
LAST_DEPLOY_FILE=".last-deploy-commit"
LAST_COMMIT=""
if [ -f "$LAST_DEPLOY_FILE" ]; then
    LAST_COMMIT=$(cat "$LAST_DEPLOY_FILE")
fi

# Get current commit
CURRENT_COMMIT=$(git rev-parse HEAD)

echo -e "${BLUE}🚀 Starting production deployment...${NC}"
echo ""
echo -e "${BLUE}📋 Mode: ${YELLOW}$MODE${NC}"
echo -e "${BLUE}📋 Current commit: ${CURRENT_COMMIT:0:8}${NC}"
if [ -n "$LAST_COMMIT" ]; then
    echo -e "${BLUE}📋 Last deployed: ${LAST_COMMIT:0:8}${NC}"
fi
echo ""

# Function to check if files changed in a directory
check_changes() {
    local dir="$1"
    if [ -z "$LAST_COMMIT" ]; then
        return 0  # No previous commit, assume changes
    fi
    if git diff --name-only "$LAST_COMMIT" "$CURRENT_COMMIT" | grep -q "^$dir"; then
        return 0  # Changes detected
    fi
    return 1  # No changes
}

# Function to check if Dockerfile or requirements changed
check_docker_changes() {
    if [ -z "$LAST_COMMIT" ]; then
        return 0
    fi
    if git diff --name-only "$LAST_COMMIT" "$CURRENT_COMMIT" | grep -qE "(Dockerfile|requirements|pyproject.toml|package.json|package-lock.json)"; then
        return 0
    fi
    return 1
}

# Determine what needs to be done based on mode
REBUILD_FRONTEND=false
REBUILD_BACKEND=false
RESTART_ONLY=false

case "$MODE" in
    quick)
        echo -e "${YELLOW}⚡ Quick mode: Restarting containers only (no rebuild)${NC}"
        RESTART_ONLY=true
        ;;
    frontend)
        echo -e "${YELLOW}📦 Frontend mode: Rebuilding frontend only${NC}"
        REBUILD_FRONTEND=true
        ;;
    backend)
        echo -e "${YELLOW}🔨 Backend mode: Rebuilding backend only${NC}"
        REBUILD_BACKEND=true
        ;;
    full)
        echo -e "${YELLOW}🔄 Full mode: Rebuilding everything${NC}"
        REBUILD_FRONTEND=true
        REBUILD_BACKEND=true
        ;;
    auto)
        echo -e "${YELLOW}🤖 Auto mode: Detecting changes...${NC}"
        
        # Check for Dockerfile/dependency changes first
        if check_docker_changes; then
            echo -e "${YELLOW}   → Dockerfile or dependencies changed - full rebuild needed${NC}"
            REBUILD_FRONTEND=true
            REBUILD_BACKEND=true
        else
            # Check frontend changes
            if check_changes "frontend/"; then
                echo -e "${GREEN}   → Frontend code changed - will rebuild${NC}"
                REBUILD_FRONTEND=true
            else
                echo -e "${BLUE}   → No frontend changes - skipping rebuild${NC}"
            fi
            
            # Check backend changes (excluding migrations which don't need rebuild)
            if git diff --name-only "$LAST_COMMIT" "$CURRENT_COMMIT" | grep -qE "^([^/]+\.py|core/|anime/|users/|root/)"; then
                echo -e "${GREEN}   → Backend code changed - checking if rebuild needed${NC}"
                # Check if it's just Python code (no dependency changes)
                if check_docker_changes; then
                    REBUILD_BACKEND=true
                else
                    echo -e "${BLUE}   → No dependency changes - will use existing image${NC}"
                    RESTART_ONLY=true
                fi
            else
                echo -e "${BLUE}   → No backend code changes - skipping rebuild${NC}"
            fi
        fi
        
        # If nothing needs rebuilding, just restart
        if [ "$REBUILD_FRONTEND" = false ] && [ "$REBUILD_BACKEND" = false ]; then
            echo -e "${YELLOW}   → No changes requiring rebuild - restarting only${NC}"
            RESTART_ONLY=true
        fi
        ;;
    *)
        echo -e "${RED}❌ Unknown mode: $MODE${NC}"
        echo "Available modes: quick, frontend, backend, full, auto"
        exit 1
        ;;
esac

echo ""

# Step 1: Build frontend if needed
if [ "$REBUILD_FRONTEND" = true ]; then
    echo -e "${BLUE}📦 Step 1: Building frontend static files...${NC}"
    export NODE_OPTIONS="--max-old-space-size=4096"
    
    echo -e "${BLUE}   Building frontend image...${NC}"
    docker compose build frontend
    
    echo -e "${BLUE}   Generating static files...${NC}"
    docker compose run --rm -e NODE_OPTIONS="--max-old-space-size=4096" frontend npm run build
    
    if [ ! -d "./frontend/dist" ]; then
        echo -e "${RED}❌ Error: dist folder not found!${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Frontend built successfully!${NC}"
else
    echo -e "${BLUE}📦 Step 1: Skipping frontend build${NC}"
fi

echo ""

# Step 2: Build backend if needed
if [ "$REBUILD_BACKEND" = true ]; then
    echo -e "${BLUE}🔨 Step 2: Building backend...${NC}"
    docker compose build web
    echo -e "${GREEN}✅ Backend built!${NC}"
else
    echo -e "${BLUE}🔨 Step 2: Skipping backend build${NC}"
fi

echo ""

# Step 3: Deploy/restart services
if [ "$RESTART_ONLY" = true ] && [ "$REBUILD_FRONTEND" = false ] && [ "$REBUILD_BACKEND" = false ]; then
    echo -e "${BLUE}🚀 Step 3: Restarting containers...${NC}"
    docker compose restart web celery beat
    echo -e "${GREEN}✅ Containers restarted!${NC}"
else
    echo -e "${BLUE}🚀 Step 3: Deploying with production configuration...${NC}"
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
    echo -e "${GREEN}✅ Deployment complete!${NC}"
fi

echo ""

# Step 4: Run migrations (only if backend was changed or on full deploy)
if [ "$MODE" != "frontend" ] && [ "$MODE" != "quick" ]; then
    echo -e "${BLUE}🔄 Step 4: Running database migrations...${NC}"
    sleep 2  # Wait for containers to be ready
    docker compose exec -T web uv run python manage.py migrate --noinput
    echo -e "${GREEN}✅ Migrations completed!${NC}"
else
    echo -e "${BLUE}🔄 Step 4: Skipping migrations${NC}"
fi

echo ""

# Step 5: Collect static files (if backend or static files changed)
if [ "$MODE" != "quick" ] && [ "$REBUILD_BACKEND" = true ]; then
    echo -e "${BLUE}📁 Step 5: Collecting static files...${NC}"
    docker compose exec -T web uv run python manage.py collectstatic --noinput
    echo -e "${GREEN}✅ Static files collected!${NC}"
else
    echo -e "${BLUE}📁 Step 5: Skipping static collection${NC}"
fi

echo ""

# Step 6: Wait for MinIO to be ready
echo -e "${BLUE}⏳ Step 6: Waiting for MinIO to be ready...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        echo -e "${GREEN}✅ MinIO is ready!${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo -e "${YELLOW}   Waiting for MinIO... (${RETRY_COUNT}/${MAX_RETRIES})${NC}"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ MinIO failed to start - check logs with: docker compose logs minio${NC}"
fi

echo ""

# Step 7: Health check
echo -e "${BLUE}🏥 Step 7: Running health check...${NC}"
sleep 5

if curl -sf http://localhost/api/health/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API is responding!${NC}"
else
    echo -e "${YELLOW}⚠️  API health check failed - check logs with: docker compose logs web${NC}"
fi

# Check media endpoint
echo -e "${BLUE}   Checking media endpoint...${NC}"
if curl -sf http://localhost/media/ > /dev/null 2>&1 || curl -sfI http://localhost/media/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Media endpoint is accessible!${NC}"
else
    echo -e "${YELLOW}⚠️  Media endpoint check failed - MinIO may still be initializing${NC}"
fi

# Save current commit as last deployed
echo "$CURRENT_COMMIT" > "$LAST_DEPLOY_FILE"

echo ""
echo -e "${GREEN}📊 Production Status:${NC}"
docker compose ps
echo ""
echo -e "${BLUE}📝 To view logs: docker compose logs -f${NC}"
echo -e "${BLUE}📝 Usage examples:${NC}"
echo -e "   ${YELLOW}./deploy-prod.sh quick${NC}     # Fast restart for code changes"
echo -e "   ${YELLOW}./deploy-prod.sh frontend${NC}  # Rebuild React only"
echo -e "   ${YELLOW}./deploy-prod.sh backend${NC}   # Rebuild Django only"
echo -e "   ${YELLOW}./deploy-prod.sh full${NC}      # Complete rebuild"
