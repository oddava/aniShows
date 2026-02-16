# Deployment Fix Summary

## Problem
Frontend build failing with `SIGKILL` error due to out of memory (OOM).
Container memory limit was only 128MB, which is insufficient for Vite production builds.

## Changes Made

### 1. Increased Frontend Container Memory
**File:** `docker-compose.prod.yml`
- Changed memory limit from 128MB to 2GB
- Changed reservation from 64MB to 512MB

```yaml
# Before:
deploy:
  resources:
    limits:
      memory: 128M
    reservations:
      memory: 64M

# After:
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 512M
```

### 2. Updated Package.json Build Scripts
**File:** `frontend/package.json`
- Added memory allocation to build script
- Added low-memory fallback build script

```json
"scripts": {
  "build": "NODE_OPTIONS='--max-old-space-size=4096' vite build",
  "build:lowmem": "NODE_OPTIONS='--max-old-space-size=2048' vite build",
  ...
}
```

### 3. Enhanced Deploy Script with Retry Logic
**File:** `deploy-prod.sh`
- Added retry mechanism with fallback to lower memory
- First attempt: 4GB Node.js heap
- Second attempt: 2GB Node.js heap
- Better error messages with troubleshooting steps

### 4. Updated .gitignore
**File:** `.gitignore`
- Added deployment files to prevent uncommitted changes warning

```
# Deployment files
.last-deploy-commit
static/
```

### 5. Added --yes Flag Support
**File:** `deploy-prod.sh`
- Added `--yes` / `-y` flag for CI/CD automation
- Auto-detects non-interactive mode

## Deployment Instructions

### Option 1: Deploy with --yes flag (Recommended for CI/CD)
```bash
./deploy-prod.sh full --yes
```

### Option 2: Deploy normally (Interactive)
```bash
./deploy-prod.sh full
# Will prompt for confirmation if uncommitted changes exist
```

### Option 3: Quick restart (No build)
```bash
./deploy-prod.sh quick
```

## Troubleshooting

If the build still fails:

1. **Clear node_modules and rebuild:**
   ```bash
   rm -rf frontend/node_modules
   ./deploy-prod.sh full --yes
   ```

2. **Check available system memory:**
   ```bash
   free -h
   docker system df
   ```

3. **Build locally first to test:**
   ```bash
   cd frontend
   npm ci
   npm run build
   ```

4. **Monitor build in real-time:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f frontend
   ```

## System Requirements

- **Minimum:** 2GB RAM available for Docker
- **Recommended:** 4GB RAM for comfortable builds
- **EC2 Instance:** t2.micro (1GB) may struggle, t2.small (2GB) recommended

## Monitoring

After deployment, check:
```bash
# Container status
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Memory usage
docker stats --no-stream

# Logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web
```
