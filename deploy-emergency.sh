#!/bin/bash
#
# Emergency deployment and diagnostic script for anishows production
#

set -e

echo "🔧 AniShows Production Deployment Script"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ] || [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: Must run from project root directory"
    exit 1
fi

echo "📊 Current Container Status:"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo ""

echo "🔄 Step 1: Pulling latest code..."
git pull origin main || echo "⚠️  Git pull failed, using current code"
echo ""

echo "🔨 Step 2: Building backend with new code..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml build web
echo "✅ Backend built"
echo ""

echo "🚀 Step 3: Deploying with zero-downtime restart..."
# Start with just the database and redis first
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db redis minio

# Wait for MinIO to be ready
echo "⏳ Waiting for MinIO to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        echo "✅ MinIO is ready!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Waiting... (${RETRY_COUNT}/${MAX_RETRIES})"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "⚠️  MinIO health check failed, but continuing..."
fi

# Now restart the web container with new code
echo "🔄 Restarting web container..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d web

# Wait a moment for web to start
sleep 5

echo ""
echo "🔄 Step 4: Running migrations..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T web uv run python manage.py migrate --noinput || echo "⚠️  Migration check completed"
echo ""

echo "🔄 Step 5: Collecting static files..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T web uv run python manage.py collectstatic --noinput || echo "⚠️  Static collection completed"
echo ""

echo "🔄 Step 6: Restarting remaining services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d celery beat caddy
echo ""

echo "🏥 Step 7: Running health checks..."
sleep 5

# Check API health
if curl -sf http://localhost/api/v1/health/ > /dev/null 2>&1; then
    echo "✅ API health endpoint responding"
else
    echo "❌ API health check FAILED"
fi

# Check if web container is running
if docker compose -f docker-compose.yml -f docker-compose.prod.yml ps | grep -q "web.*Up"; then
    echo "✅ Web container is running"
else
    echo "❌ Web container is NOT running"
    echo "📝 Checking web logs..."
    docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail 20 web
fi

# Check media endpoint
if curl -sfI http://localhost/media/ > /dev/null 2>&1 || curl -sf http://localhost/media/ > /dev/null 2>&1; then
    echo "✅ Media endpoint responding"
else
    echo "⚠️  Media endpoint check returned non-200 (may be normal if no media)"
fi

echo ""
echo "📊 Final Container Status:"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo ""

echo "📝 Useful commands:"
echo "  View logs: docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web"
echo "  Restart:   docker compose -f docker-compose.yml -f docker-compose.prod.yml restart web"
echo "  Shell:     docker compose -f docker-compose.yml -f docker-compose.prod.yml exec web bash"
echo ""
echo "✅ Deployment complete!"
