#!/bin/bash
#
# Production deployment script for anishows
# Builds static frontend and deploys with optimized configuration
#

set -e

echo "🚀 Starting production deployment..."
echo ""

# Increase Node.js memory limit for build
export NODE_OPTIONS="--max-old-space-size=4096"

echo "📋 Build Configuration:"
echo "   - Node.js memory limit: 4GB"
echo ""

# Step 1: Build frontend static files
echo "📦 Step 1/4: Building frontend static files..."
docker compose build frontend

# Build with increased memory
docker compose run --rm -e NODE_OPTIONS="--max-old-space-size=4096" frontend npm run build

echo ""
echo "✅ Frontend built successfully!"
echo ""

# Step 2: Pull latest backend changes (optional)
echo "🔨 Step 2/4: Building backend..."
docker compose build web

echo ""
echo "✅ Backend built!"
echo ""

# Step 3: Deploy with production configuration
echo "🚀 Step 3/4: Deploying production services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo ""
echo "✅ Production deployment complete!"
echo ""

# Step 4: Health check
echo "🏥 Step 4/4: Running health check..."
sleep 5

if curl -sf http://localhost/api/health/ > /dev/null 2>&1; then
    echo "✅ API is responding!"
else
    echo "⚠️  API health check failed - check logs with: docker compose logs web"
fi

echo ""
echo "📊 Production Status:"
docker compose ps
echo ""
echo "📝 To view logs: docker compose logs -f"
echo "🔄 To redeploy after code changes, run this script again"
