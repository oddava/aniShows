#!/bin/bash
#
# Production deployment script for anishows
# Supports multiple deployment modes for faster updates
#
# Usage:
#   ./deploy-prod.sh [mode] [--yes|-y]
#
# Modes:
#   quick       - Fast restart (no rebuild, for code-only changes)
#   frontend    - Rebuild frontend only (React changes)
#   backend     - Rebuild backend only (Django/Python changes + deps)
#   full        - Full rebuild (everything, slowest)
#   auto        - Detect changes and rebuild only what's needed (default)
#
# Options:
#   --yes, -y   - Skip confirmation prompts (for CI/CD)
#
# Examples:
#   ./deploy-prod.sh quick                # Fast restart for small code changes
#   ./deploy-prod.sh frontend             # Only rebuild React app
#   ./deploy-prod.sh backend              # Only rebuild Python/Django
#   ./deploy-prod.sh full                 # Complete rebuild (Dockerfile changes)
#   ./deploy-prod.sh full --yes           # Full rebuild without confirmation
#

set -e

# Parse arguments
MODE="auto"
FORCE_YES=false

for arg in "$@"; do
    case $arg in
        --yes|-y)
            FORCE_YES=true
            shift
            ;;
        quick|frontend|backend|full|auto)
            MODE="$arg"
            shift
            ;;
    esac
done

# If no mode specified, default to auto
if [ -z "$MODE" ]; then
    MODE="auto"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Docker Compose command with production files
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# Error handler
cleanup_on_error() {
    local exit_code=$?
    echo ""
    echo -e "${RED}❌ Deployment failed with exit code ${exit_code}${NC}"
    echo -e "${YELLOW}📋 Troubleshooting:${NC}"
    echo -e "   ${BLUE}1. Check container status:${NC} $COMPOSE_CMD ps"
    echo -e "   ${BLUE}2. View web logs:${NC} $COMPOSE_CMD logs web --tail 50"
    echo -e "   ${BLUE}3. View frontend build logs:${NC} $COMPOSE_CMD logs frontend --tail 50"
    echo -e "   ${BLUE}4. View MinIO logs:${NC} $COMPOSE_CMD logs minio --tail 20"
    exit $exit_code
}

trap cleanup_on_error ERR

# Check prerequisites
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git is not installed${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    exit 1
fi

# Check if we're in the right directory (has docker-compose.yml)
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}❌ docker-compose.yml not found in current directory${NC}"
    echo -e "${YELLOW}   Please run this script from the project root directory${NC}"
    exit 1
fi

# Check if production compose file exists
if [ ! -f "docker-compose.prod.yml" ]; then
    echo -e "${RED}❌ docker-compose.prod.yml not found${NC}"
    exit 1
fi

# Check for uncommitted changes (safety feature)
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    echo -e "${YELLOW}   Current changes:${NC}"
    git status --short
    echo ""
    
    # Skip confirmation if --yes flag is set or running in non-interactive mode
    if [ "$FORCE_YES" = true ]; then
        echo -e "${BLUE}   --yes flag set: Continuing with uncommitted changes${NC}"
    elif [ "$MODE" = "quick" ]; then
        echo -e "${BLUE}   Quick mode: Continuing with uncommitted changes${NC}"
    elif [ ! -t 0 ]; then
        # Non-interactive mode (CI/CD)
        echo -e "${YELLOW}   Non-interactive mode detected, continuing with uncommitted changes${NC}"
        echo -e "${YELLOW}   Use --yes flag to suppress this warning${NC}"
    else
        read -p "Continue deployment? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${RED}❌ Deployment cancelled${NC}"
            exit 1
        fi
    fi
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

# Docker Compose command with production files
COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# Step 1: Build frontend if needed
if [ "$REBUILD_FRONTEND" = true ]; then
    echo -e "${BLUE}📦 Step 1: Building frontend static files...${NC}"
    export NODE_OPTIONS="--max-old-space-size=4096"
    
    # Check if frontend node_modules exists
    if [ ! -d "./frontend/node_modules" ]; then
        echo -e "${YELLOW}⚠️  Frontend node_modules not found, installing dependencies...${NC}"
        $COMPOSE_CMD run --rm frontend npm ci
    fi
    
    echo -e "${BLUE}   Building frontend image...${NC}"
    $COMPOSE_CMD build frontend
    
    echo -e "${BLUE}   Generating static files...${NC}"
    echo -e "${BLUE}   Using 4GB memory limit for Node.js build process${NC}"
    
    # Build frontend using production configuration with retry logic
    BUILD_ATTEMPTS=0
    MAX_ATTEMPTS=2
    BUILD_SUCCESS=false
    
    # Build the frontend image with builder target first
    echo -e "${BLUE}   Building frontend image with production dependencies...${NC}"
    $COMPOSE_CMD build --target builder frontend
    
    while [ $BUILD_ATTEMPTS -lt $MAX_ATTEMPTS ] && [ "$BUILD_SUCCESS" = false ]; do
        BUILD_ATTEMPTS=$((BUILD_ATTEMPTS + 1))
        echo -e "${BLUE}   Build attempt ${BUILD_ATTEMPTS}/${MAX_ATTEMPTS}...${NC}"
        
        if [ $BUILD_ATTEMPTS -eq 1 ]; then
            # First attempt: Full memory
            if $COMPOSE_CMD run --rm -e NODE_OPTIONS="--max-old-space-size=4096" --entrypoint npm frontend run build; then
                BUILD_SUCCESS=true
            else
                echo -e "${YELLOW}⚠️  Build failed, trying with lower memory optimization...${NC}"
            fi
        else
            # Second attempt: Use low memory build script
            echo -e "${BLUE}   Attempting build with 2GB memory limit...${NC}"
            if $COMPOSE_CMD run --rm -e NODE_OPTIONS="--max-old-space-size=2048" --entrypoint npm frontend run build:lowmem; then
                BUILD_SUCCESS=true
            fi
        fi
    done
    
    if [ "$BUILD_SUCCESS" = false ]; then
        echo -e "${RED}❌ Frontend build failed after ${MAX_ATTEMPTS} attempts!${NC}"
        echo -e "${YELLOW}   Check build logs: $COMPOSE_CMD logs frontend${NC}"
        echo -e "${YELLOW}   Possible causes:${NC}"
        echo -e "      - Insufficient memory on host system"
        echo -e "      - Corrupted node_modules (try: rm -rf frontend/node_modules)"
        echo -e "      - TypeScript/JavaScript errors in code"
        exit 1
    fi
    
    # Wait a moment for files to sync
    sleep 2
    
    if [ ! -d "./frontend/dist" ]; then
        echo -e "${RED}❌ Error: dist folder not found!${NC}"
        echo -e "${YELLOW}   Build may have succeeded but dist folder was not created${NC}"
        exit 1
    fi
    
    # Verify dist folder has content
    if [ ! "$(ls -A ./frontend/dist)" ]; then
        echo -e "${RED}❌ Error: dist folder is empty!${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Frontend built successfully!${NC}"
    echo -e "${BLUE}   Dist folder size: $(du -sh ./frontend/dist | cut -f1)${NC}"
else
    echo -e "${BLUE}📦 Step 1: Skipping frontend build${NC}"
fi

echo ""

# Step 2: Build backend if needed
if [ "$REBUILD_BACKEND" = true ]; then
    echo -e "${BLUE}🔨 Step 2: Building backend...${NC}"
    $COMPOSE_CMD build web
    echo -e "${GREEN}✅ Backend built!${NC}"
else
    echo -e "${BLUE}🔨 Step 2: Skipping backend build${NC}"
fi

echo ""

# Step 3: Deploy/restart services
if [ "$RESTART_ONLY" = true ] && [ "$REBUILD_FRONTEND" = false ] && [ "$REBUILD_BACKEND" = false ]; then
    echo -e "${BLUE}🚀 Step 3: Restarting containers...${NC}"
    $COMPOSE_CMD restart web celery beat
    echo -e "${GREEN}✅ Containers restarted!${NC}"
else
    echo -e "${BLUE}🚀 Step 3: Deploying with production configuration...${NC}"
    $COMPOSE_CMD up -d
    echo -e "${GREEN}✅ Deployment complete!${NC}"
fi

echo ""

# Step 4: Run migrations (only if backend was changed or on full deploy)
if [ "$MODE" != "frontend" ] && [ "$MODE" != "quick" ]; then
    echo -e "${BLUE}🔄 Step 4: Running database migrations...${NC}"
    sleep 3  # Wait for containers to be ready
    $COMPOSE_CMD exec -T web uv run python manage.py migrate --noinput
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Migrations completed!${NC}"
    else
        echo -e "${RED}❌ Migrations failed!${NC}"
        echo -e "${YELLOW}   Check logs: $COMPOSE_CMD logs web${NC}"
        exit 1
    fi
else
    echo -e "${BLUE}🔄 Step 4: Skipping migrations${NC}"
fi

echo ""

# Step 5: Collect static files (if backend or static files changed)
if [ "$MODE" != "quick" ] && [ "$REBUILD_BACKEND" = true ]; then
    echo -e "${BLUE}📁 Step 5: Collecting static files...${NC}"
    $COMPOSE_CMD exec -T web uv run python manage.py collectstatic --noinput
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Static files collected!${NC}"
    else
        echo -e "${YELLOW}⚠️  Static files collection had issues${NC}"
    fi
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
    echo -e "${RED}❌ MinIO failed to start - check logs with: $COMPOSE_CMD logs minio${NC}"
fi

echo ""

# Step 7: Health check
echo -e "${BLUE}🏥 Step 7: Running health check...${NC}"
sleep 5

# Check if API is responding
HEALTH_STATUS=$(curl -sf http://localhost/api/health/ -w "%{http_code}" -o /dev/null 2>&1 || echo "000")

if [ "$HEALTH_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ API is responding (HTTP 200)!${NC}"
elif [ "$HEALTH_STATUS" = "301" ] || [ "$HEALTH_STATUS" = "302" ]; then
    echo -e "${GREEN}✅ API is responding (HTTP ${HEALTH_STATUS} redirect)!${NC}"
else
    echo -e "${YELLOW}⚠️  API health check failed (HTTP ${HEALTH_STATUS}) - check logs with: $COMPOSE_CMD logs web${NC}"
fi

# Check media endpoint
echo -e "${BLUE}   Checking media endpoint...${NC}"
MEDIA_STATUS=$(curl -sfI http://localhost/media/ -w "%{http_code}" -o /dev/null 2>&1 || echo "000")

if [ "$MEDIA_STATUS" = "200" ] || [ "$MEDIA_STATUS" = "301" ] || [ "$MEDIA_STATUS" = "302" ]; then
    echo -e "${GREEN}✅ Media endpoint is accessible (HTTP ${MEDIA_STATUS})!${NC}"
else
    echo -e "${YELLOW}⚠️  Media endpoint check failed (HTTP ${MEDIA_STATUS}) - MinIO may still be initializing${NC}"
fi

# Save current commit as last deployed
echo "$CURRENT_COMMIT" > "$LAST_DEPLOY_FILE"

echo ""

# Step 8: Cleanup old Docker images (optional, keeps last 3 versions)
echo -e "${BLUE}🧹 Step 8: Cleaning up old Docker images...${NC}"
# Remove dangling images
docker image prune -f > /dev/null 2>&1 || true
# Remove old anishows images (keep last 3)
docker images --format "{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}" | \
    grep "anishows" | \
    sort -k3 -r | \
    tail -n +4 | \
    awk '{print $2}' | \
    xargs -r docker rmi > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Cleanup completed${NC}"

echo ""
echo -e "${GREEN}📊 Production Status:${NC}"
$COMPOSE_CMD ps
echo ""
echo -e "${BLUE}📝 To view logs: $COMPOSE_CMD logs -f${NC}"
echo -e "${BLUE}📝 Usage examples:${NC}"
echo -e "   ${YELLOW}./deploy-prod.sh quick${NC}              # Fast restart for code changes"
echo -e "   ${YELLOW}./deploy-prod.sh frontend${NC}           # Rebuild React only"
echo -e "   ${YELLOW}./deploy-prod.sh backend${NC}            # Rebuild Django only"
echo -e "   ${YELLOW}./deploy-prod.sh full${NC}               # Complete rebuild"
echo -e "   ${YELLOW}./deploy-prod.sh full --yes${NC}         # Full rebuild without prompts (CI/CD)"
echo ""
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
