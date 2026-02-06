#!/bin/bash
#
# Memory-efficient Docker build script for anishows
# This script builds images sequentially to prevent OOM issues
#

set -e

echo "🐳 Starting memory-efficient Docker build..."
echo ""

# Export BuildKit settings for better memory management
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain

# Memory limit for builds (adjust based on your system)
export BUILD_MEMORY_LIMIT="1g"

echo "📋 Build Configuration:"
echo "   - BuildKit enabled: $DOCKER_BUILDKIT"
echo "   - Memory limit per build: $BUILD_MEMORY_LIMIT"
echo ""

# Build web first (this creates the anishows_web:latest image)
echo "🔨 Step 1/4: Building web (Django backend)..."
docker compose build --memory="$BUILD_MEMORY_LIMIT" web

echo ""
echo "🔨 Step 2/4: Building frontend..."
docker compose build --memory="$BUILD_MEMORY_LIMIT" frontend

echo ""
echo "🔨 Step 3/4: Building backup service..."
docker compose build --memory="$BUILD_MEMORY_LIMIT" backup

echo ""
echo "✅ All images built successfully!"
echo ""
echo "🚀 Starting services..."
docker compose up -d

echo ""
echo "✅ Build and deployment complete!"
echo ""
echo "📊 To check memory usage: docker stats"
echo "📝 To view logs: docker compose logs -f"
