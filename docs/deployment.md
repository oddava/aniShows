# AniShows Deployment Guide

This guide covers deploying AniShows to a production environment on AWS EC2 with Ubuntu, PostgreSQL, Nginx, and SSL.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [EC2 Instance Setup](#ec2-instance-setup)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Application Deployment](#application-deployment)
6. [Nginx Configuration](#nginx-configuration)
7. [SSL/HTTPS Setup](#sslhttps-setup)
8. [Systemd Services](#systemd-services)
9. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Prerequisites

- AWS Account with EC2 access
- Domain name (optional but recommended for SSL)
- SSH key pair for EC2 access
- Basic familiarity with Linux command line

---

## EC2 Instance Setup

### 1. Launch EC2 Instance

1. Go to AWS Console → EC2 → Launch Instance
2. Choose **Ubuntu 22.04 LTS** (64-bit x86)
3. Select instance type: **t3.small** minimum (2 vCPU, 2GB RAM)
4. Configure Security Group:
   - SSH (22) - Your IP only
   - HTTP (80) - 0.0.0.0/0
   - HTTPS (443) - 0.0.0.0/0
5. Add storage: 20GB+ gp3 (SSD)
6. Launch with your SSH key pair

### 2. Connect to Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

### 3. Update System

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget build-essential
```

### 4. Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker ubuntu
newgrp docker

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

---

## Environment Configuration

### 1. Clone Repository

```bash
cd /home/ubuntu
git clone https://github.com/oddava/aniShows.git
cd aniShows
```

### 2. Create Production Environment File

```bash
cp .env.example .env
nano .env
```

**Production `.env` Settings:**

```ini
# Django - CRITICAL: Change these!
DEBUG=False
DJANGO_SECRET_KEY=your-very-long-random-secret-key-here
ALLOWED_HOSTS=your-domain.com,www.your-domain.com,your-ec2-ip

# Database - CRITICAL: Use strong passwords!
DB_NAME=anishows_db
DB_USER=anishows_user
DB_PASSWORD=your-super-secure-db-password
DB_HOST=db
DB_PORT=5432

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO/S3 Storage
USE_S3=True
AWS_ACCESS_KEY_ID=your-minio-access-key
AWS_SECRET_ACCESS_KEY=your-minio-secret-key
AWS_STORAGE_BUCKET_NAME=anishows-media
AWS_S3_ENDPOINT_URL=http://minio:9000
AWS_S3_REGION_NAME=us-east-1
MINIO_PUBLIC_DOMAIN=your-domain.com:9000

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
VITE_GOOGLE_CLIENT_ID=your-google-client-id

# Frontend URL
FRONTEND_URL=https://your-domain.com

# CORS & CSRF
CORS_ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
CSRF_TRUSTED_ORIGINS=https://your-domain.com,https://www.your-domain.com

# SSL Redirect (enable after SSL is configured)
SECURE_SSL_REDIRECT=True

# Email (optional)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
```

> ⚠️ **Security Notes:**
> - Generate a strong `DJANGO_SECRET_KEY`: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`
> - Use unique, strong passwords for all services
> - Never commit `.env` files to version control

---

## Database Setup

PostgreSQL is handled by Docker Compose via the `db` service. The database will be automatically created when containers start.

For external database (RDS), update these settings:
```ini
DB_HOST=your-rds-endpoint.amazonaws.com
DB_PORT=5432
```

---

## Application Deployment

### 1. Update docker-compose.yml for Production

Edit `docker-compose.yml` and update the web service:

```yaml
services:
  web:
    # ... existing config ...
    environment:
      DEBUG: "False"  # Ensure this is False
    # Remove: - .:/app volume mount (not needed in production)
```

### 2. Build and Start

```bash
# Build containers
docker compose build

# Start services in detached mode
docker compose up -d

# Run migrations
docker compose exec web uv run python manage.py migrate

# Create superuser
docker compose exec web uv run python manage.py createsuperuser

# Collect static files
docker compose exec web uv run python manage.py collectstatic --noinput
```

### 3. Initialize MinIO Bucket

Access MinIO Console at `http://your-ip:9001`:
1. Login with credentials from `.env`
2. Create bucket named `anishows-media`
3. Set bucket policy to public or configure proper access

---

## Caddy Reverse Proxy & SSL Setup

Caddy handles automatic SSL (via Let's Encrypt) and reverse proxying through the `caddy` container. This replaces the need for Nginx and Certbot.

### 1. Configuration Check

Ensure your `Caddyfile` is in the root directory and contains the correct routing logic.

### 2. Domain Environment Variables

Update your `.env` with your production domain and email:
```ini
DOMAIN_NAME=your-domain.com
EMAIL_HOST_USER=your-email@gmail.com
```

### 3. Deployment

Caddy is managed by Docker Compose. Starting the application also starts the proxy:

```bash
docker compose up -d
```

### 4. Verify SSL

Caddy will automatically attempt to provision a certificate once your domain DNS points to the server. You can monitor the logs for progress:

```bash
docker compose logs -f caddy
```

### 5. Final HTTPS Check

Once verify SSL is successful, ensure your `.env` has:
```ini
SECURE_SSL_REDIRECT=True
```
Then restart the app:
```bash
docker compose restart web
```

---

## Systemd Services

Create a systemd service for automatic startup:

```bash
sudo nano /etc/systemd/system/anishows.service
```

```ini
[Unit]
Description=AniShows Docker Compose Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/aniShows
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=ubuntu
Group=docker

[Install]
WantedBy=multi-user.target
```

Enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable anishows
```

---

## Monitoring & Maintenance

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f web
docker compose logs -f frontend
docker compose logs -f celery
```

### Backup

```bash
# Manual backup
docker compose exec backup /app/shell/backup.sh manual

# List backups
docker compose exec backup ls -lh /backups

# Restore
docker compose exec backup /app/shell/restore.sh YYYYMMDD_HHMMSS
```

### Update Application

```bash
cd /home/ubuntu/aniShows
git pull origin main
docker compose build
docker compose up -d
docker compose exec web uv run python manage.py migrate
docker compose exec web uv run python manage.py collectstatic --noinput
```

### Resource Monitoring

```bash
# Container stats
docker stats

# Disk usage
df -h

# Memory usage
free -h
```

---

## Firewall Configuration (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
```

---

## Troubleshooting

### Containers not starting
```bash
docker compose logs
docker compose ps
```

### Database connection issues
```bash
docker compose exec web uv run python manage.py dbshell
```

### Permission issues
```bash
sudo chown -R ubuntu:ubuntu /home/ubuntu/aniShows
```

### Clear cache
```bash
docker compose exec redis redis-cli FLUSHALL
```

---

## Production Checklist

- [ ] `DEBUG=False` in `.env`
- [ ] Strong, unique `DJANGO_SECRET_KEY`
- [ ] Strong database passwords
- [ ] SSL/HTTPS configured
- [ ] `SECURE_SSL_REDIRECT=True`
- [ ] Firewall enabled (UFW)
- [ ] Automated backups configured
- [ ] Log rotation configured
- [ ] Monitoring set up (optional: Prometheus/Grafana)
