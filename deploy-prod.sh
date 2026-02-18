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

# Step 1: Build frontend if needed
if [ "$REBUILD_FRONTEND" = true ]; then
    echo -e "${BLUE}📦 Step 1: Building frontend static files...${NC}"
    export NODE_OPTIONS="--max-old-space-size=4096"
    
    echo -e "${BLUE}   Building frontend image (includes npm run build)...${NC}"
    echo -e "${BLUE}   Using 4GB memory limit for Node.js build process${NC}"
    
    # Build frontend using production target - this runs npm run build inside the container
    BUILD_ATTEMPTS=0
    MAX_ATTEMPTS=2
    BUILD_SUCCESS=false
    
    while [ $BUILD_ATTEMPTS -lt $MAX_ATTEMPTS ] && [ "$BUILD_SUCCESS" = false ]; do
        BUILD_ATTEMPTS=$((BUILD_ATTEMPTS + 1))
        echo -e "${BLUE}   Build attempt ${BUILD_ATTEMPTS}/${MAX_ATTEMPTS}...${NC}"
        
        # Build with target builder which includes the npm run build step
        if docker build \
            --target builder \
            --build-arg NODE_ENV=production \
            --build-arg VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID}" \
            --build-arg ALLOWED_HOSTS="${ALLOWED_HOSTS}" \
            -t anishows_frontend:builder \
            -f ./frontend/Dockerfile \
            ./frontend; then
            
            # Extract the dist folder from the builder image
            echo -e "${BLUE}   Extracting build artifacts...${NC}"
            docker create --name frontend_builder anishows_frontend:builder
            # Remove old dist folder if exists
            rm -rf ./frontend/dist
            # Copy with proper handling of permissions
            docker cp frontend_builder:/app/dist ./frontend/ 2>/dev/null || true
            # Fix permissions on the copied files
            chmod -R 755 ./frontend/dist 2>/dev/null || true
            docker rm frontend_builder
            
            BUILD_SUCCESS=true
        else
            echo -e "${YELLOW}⚠️  Build attempt ${BUILD_ATTEMPTS} failed${NC}"
            if [ $BUILD_ATTEMPTS -lt $MAX_ATTEMPTS ]; then
                echo -e "${BLUE}   Retrying with lower memory...${NC}"
                export NODE_OPTIONS="--max-old-space-size=2048"
            fi
        fi
    done
    
    if [ "$BUILD_SUCCESS" = false ]; then
        echo -e "${RED}❌ Frontend build failed after ${MAX_ATTEMPTS} attempts!${NC}"
        echo -e "${YELLOW}   Possible causes:${NC}"
        echo -e "      - Insufficient memory on host system"
        echo -e "      - TypeScript/JavaScript errors in code"
        echo -e "      - Corrupted node_modules"
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
    
    if $COMPOSE_CMD exec -T web uv run python manage.py migrate --noinput; then
        echo -e "${GREEN}✅ Migrations complete!${NC}"
    else
        echo -e "${YELLOW}⚠️  Migration warning (may be already applied)${NC}"
    fi
else
    echo -e "${BLUE}🔄 Step 4: Skipping migrations (frontend/quick mode)${NC}"
fi

echo ""

# Step 5: Collect static files (only if backend was changed)
if [ "$REBUILD_BACKEND" = true ] || [ "$MODE" = "full" ]; then
    echo -e "${BLUE}🎨 Step 5: Collecting static files...${NC}"
    $COMPOSE_CMD exec -T web uv run python manage.py collectstatic --noinput --clear
    echo -e "${GREEN}✅ Static files collected!${NC}"
else
    echo -e "${BLUE}🎨 Step 5: Skipping static collection${NC}"
fi

echo ""

# Save current commit as last deployed
echo "$CURRENT_COMMIT" > "$LAST_DEPLOY_FILE"

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Services status:${NC}"
$COMPOSE_CMD ps

echo ""
echo -e "${BLUE}📝 Useful commands:${NC}"
echo -e "   ${BLUE}View logs:${NC} $COMPOSE_CMD logs -f web"
echo -e "   ${BLUE}View all logs:${NC} $COMPOSE_CMD logs -f"
echo -e "   ${BLUE}Scale workers:${NC} $COMPOSE_CMD up -d --scale celery=3"
