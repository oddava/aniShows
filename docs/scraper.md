# Anime Scraper & Production Guide

## Real-time Anime Scraper

This project includes a robust, background scraping system powered by **Celery** and **Redis**. It automatically fetches data from the AniList API to keep your catalog up-to-date.

### Architecture
*   **Service**: `anime.services.anilist.AniListService` (Handles API requests, Rate Limiting, Persistence)
*   **Tasks**: `anime.tasks` (Defines background jobs)
*   **Broker**: Redis (Stores task queue)
*   **Scheduler**: Celery Beat (Triggers tasks on schedule)

---

## Automated Schedules (Celery Beat)

The scraper runs automatically via Celery Beat. **No manual intervention required** once set up.

| Task | Schedule | Purpose |
|------|----------|---------|
| `sync-trending-every-hour` | Every Hour | Catches new episodes, score updates, currently airing shows |
| `sync-seasonal-daily` | Daily @ 4:00 AM UTC | Full list of anime for current season |
| `sync-next-season-weekly` | Weekly (Sunday @ 5:00 AM UTC) | Upcoming anime for next season |

### Verify Beat is Running
```bash
docker compose logs beat --tail 20
```

You should see:
```
beat-1  | [INFO/MainProcess] beat: Starting...
```

### Verify Celery Worker
```bash
docker compose logs celery --tail 20
```

You should see registered tasks and "celery ready" message.

---

## Manual Commands

### Trigger Sync via Shell
```bash
docker compose exec web uv run python manage.py shell -c "
from anime.tasks import sync_trending_anime
sync_trending_anime.delay(limit=50)
"
```

### Backfill Catalog (One-time)
For a fresh database, run this to populate anime data:
```bash
docker compose exec web uv run python manage.py shell -c "
from anime.tasks import backfill_catalog
backfill_catalog.delay(start_page=1, pages=50)
"
```

---

## Local S3 Storage (MinIO)

For development, we use **MinIO** for S3-compatible local storage.

### Quick Setup (After Fresh Install)

Run these commands to set up MinIO after `docker compose up -d`:

```bash
# Set up MinIO alias
docker exec anishows-minio-1 mc alias set myminio http://localhost:9000 minioadmin minioadmin

# Create bucket
docker exec anishows-minio-1 mc mb myminio/anishows-media --ignore-existing

# Set bucket to public (required for images to load in browser)
docker exec anishows-minio-1 mc anonymous set public myminio/anishows-media
```

> **Note**: If you remove Docker volumes (`docker compose down -v`), you need to run these commands again!

### MinIO Console
*   **URL**: `http://localhost:9001`
*   **Credentials**: `minioadmin` / `minioadmin`

### Environment Variables
```env
USE_S3=True
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_STORAGE_BUCKET_NAME=anishows-media
AWS_S3_REGION_NAME=us-east-1
AWS_S3_ENDPOINT_URL=http://minio:9000
```

---

## Troubleshooting

### Images Not Loading
1. Check if bucket exists and is public:
   ```bash
   docker exec anishows-minio-1 mc ls myminio/anishows-media/
   ```
2. If empty or error, run the Quick Setup commands above.

### Scraper Not Running
1. Check Celery worker: `docker compose logs celery --tail 30`
2. Check Beat scheduler: `docker compose logs beat --tail 30`
3. Trigger manual sync to test.

### Database Tables Missing
```bash
docker compose exec web uv run python manage.py migrate
```
