# Docker Setup Guide

## 🚀 Quick Start

### Development Mode (Hot Reload)
```bash
# Uses Vite dev server - changes appear instantly
docker compose up -d
```

### Production Mode (Optimized)
```bash
# Build static files and deploy with caching
./deploy-prod.sh
```

---

## 📁 Configuration Files

| File | Environment | Purpose |
|------|-------------|---------|
| `docker-compose.yml` | Development | Main configuration with Vite dev server |
| `docker-compose.prod.yml` | Production | Overrides for production (static files) |
| `Caddyfile` | Development | Proxies to Vite dev server on port 5173 |
| `Caddyfile.prod` | Production | Serves static files with caching |
| `deploy-prod.sh` | Production | Automated deployment script |

---

## 🔧 Development Mode

**Best for:** Active development, debugging, testing changes

**Features:**
- ✅ Hot Module Replacement (HMR) - instant updates
- ✅ Source maps for debugging
- ✅ Detailed error messages
- ✅ Volume-mounted code (changes reflect immediately)

**Run:**
```bash
docker compose up -d
```

**Access:**
- App: http://localhost (port 80 via Caddy)
- Vite Dev Server: http://localhost:5173 (direct)
- API: http://localhost/api/
- MinIO: http://localhost:9001

---

## 🏭 Production Mode

**Best for:** Live deployment, performance, security

**Features:**
- ✅ Pre-built static files (faster loading)
- ✅ Aggressive caching (better performance)
- ✅ Security headers (HSTS, CSP, etc.)
- ✅ Gzip/Brotli compression
- ✅ HTTP/3 support
- ✅ Optimized memory usage

**Deploy:**
```bash
# One-command deployment
./deploy-prod.sh
```

**Or manually:**
```bash
# 1. Build frontend static files
docker compose build frontend
docker compose run --rm frontend npm run build

# 2. Build backend
docker compose build web

# 3. Deploy with production config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## ⚠️ IMPORTANT: Don't Use Dev Server in Production!

The Vite dev server (`npm run dev`) is **NOT** suitable for production:

| Issue | Why It's Bad |
|-------|--------------|
| Performance | Compiles on-demand, slower response |
| Memory Usage | Keeps entire app in memory (~300MB extra) |
| Security | Exposes source maps and detailed errors |
| SEO | Poor initial load, no prerendering |
| Stability | Not designed for concurrent users |

**Always use production mode for live deployments!**

---

## 🔄 Updating Production

After making code changes:

```bash
# Pull latest code
git pull

# Rebuild and deploy
./deploy-prod.sh
```

The script will:
1. Build new static frontend files
2. Build updated backend
3. Deploy with zero-downtime (containers restart)

---

## 🛠️ Troubleshooting

### Frontend changes not appearing (Development)
```bash
# Hard refresh browser: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

# If still not working, restart frontend:
docker compose restart frontend
```

### Frontend changes not appearing (Production)
```bash
# Static files weren't rebuilt. Run:
docker compose run --rm frontend npm run build

# Or full redeploy:
./deploy-prod.sh
```

### Memory issues during build
```bash
# Use the memory-safe build script
./docker-build.sh

# Or build sequentially:
docker compose build web
docker compose build frontend
docker compose up -d
```

### Caddy config errors
```bash
# Validate Caddyfile
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile

# Reload Caddy without restart
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 📊 Resource Limits

Default memory limits (adjust in docker-compose.yml):

| Service | Limit | Reservation |
|---------|-------|-------------|
| web | 512MB | 128MB |
| frontend | 512MB | 128MB |
| db | 512MB | 256MB |
| redis | 256MB | 64MB |
| celery | 512MB | 128MB |
| beat | 256MB | 64MB |
| minio | 512MB | 128MB |
| backup | 256MB | 64MB |
| caddy | 128MB | 32MB |

---

## 🔒 Security Checklist for Production

- [ ] Change default passwords in `.env`
- [ ] Set `DEBUG=False` in `.env`
- [ ] Configure `DOMAIN_NAME` in `.env`
- [ ] Set up SSL certificates (Caddy handles this automatically)
- [ ] Review Content Security Policy in `Caddyfile.prod`
- [ ] Enable fail2ban or similar for brute force protection
- [ ] Regular backups (already configured with backup service)
