# Deployment Guide

This guide covers how to deploy the **aniShows** project using Docker Compose. The current setup runs the Django backend with Gunicorn and the React frontend with Vite.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed.
- [Docker Compose](https://docs.docker.com/compose/install/) installed (usually included with Docker Desktop/Engine).
- [Make](https://www.gnu.org/software/make/) (optional, for using shortcut commands).

## 1. Environment Configuration

The project relies on environment variables defined in `.env` files.

1.  Create a `.env` directory if it doesn't exist.
2.  Create `.env/env.prod` for production variables.
3.  Ensure the following variables are set:

```ini
# .env/.env.prod

# Django
DEBUG=False
DJANGO_SECRET_KEY=your-super-secret-key-here
ALLOWED_HOSTS=web,localhost,127.0.0.1,your-domain.com

# Database
DB_NAME=anishows_db
DB_USER=postgres
DB_PASSWORD=your-db-password
DB_HOST=db
DB_PORT=5432

# MinIO (S3 Compatible Storage)
USE_S3=True
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_STORAGE_BUCKET_NAME=anishows-media
AWS_S3_ENDPOINT_URL=http://minio:9000
AWS_S3_REGION_NAME=us-east-1

# Redis / Celery
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

## 2. Deployment

We use a `makefile` to simplify Docker lifecycle management.

### First Time Setup

1.  **Build the containers**:
    ```bash
    make build
    ```

2.  **Start the services**:
    ```bash
    make up
    ```

3.  **Run Migrations**:
    Apply database schema changes.
    ```bash
    make mig
    ```

4.  **Create Superuser**:
    Create an admin account to access the Django Admin panel.
    ```bash
    make superuser
    ```

5.  **Import Initial Data (Optional)**:
    If you have a data import script configured:
    ```bash
    make import_anime
    ```

### Routine Deployment

To restart services after code changes:

```bash
make restart
```

To stop all services:

```bash
make down
```

## 3. Monitoring & Maintenance

### Viewing Logs

View logs for all services:
```bash
make logs
```

View specific service logs:
```bash
make web-logs      # Django Backend
make front-logs    # React Frontend
make celery-logs   # Celery Worker/Beat
```

### Database Backups

It is recommended to set up periodic backups for the PostgreSQL volume (`db_data`) and MinIO volume (`minio_data`).

## 4. Architecture Notes

- **Backend**: Django running via Gunicorn.
- **Frontend**: React running via Vite (currently configured for development/preview mode on port `5173`).
- **Database**: PostgreSQL 16.
- **Cache/Broker**: Redis.
- **Storage**: MinIO (S3 compatible) for media files.
- **Reverse Proxy**: Currently handling direct port exposure. Ideally, put **Nginx** or **Caddy** in front of `web:8000` and `frontend:5173` for SSL termination and unified routing in a true production environment.
