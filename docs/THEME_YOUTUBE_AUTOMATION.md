# YouTube URL Automation for Theme Songs

## Summary

Automated YouTube URL generation has been implemented to ensure all theme songs have clickable YouTube links.

## What Was Fixed

### 1. Auto-Backfill During Theme Sync (`apps/animes/tasks/themes.py`)
- Added `_backfill_missing_youtube_urls()` method that runs after theme sync
- Automatically generates YouTube URLs for any themes missing them
- Runs immediately when themes are synced for an anime

### 2. Periodic Backfill Task (`apps/animes/tasks/themes.py`)
- Added `backfill_theme_youtube_urls` Celery task
- Runs twice daily (8:30 AM and 8:30 PM)
- Processes up to 100 themes per run
- Catches any themes that might have been missed

### 3. Celery Beat Schedule (`root/settings/base.py`)
- Added two periodic tasks:
  - `backfill-theme-youtube-urls-morning`: 8:30 AM daily
  - `backfill-theme-youtube-urls-evening`: 8:30 PM daily

### 4. Task Export (`apps/animes/tasks/__init__.py`)
- Exported `backfill_theme_youtube_urls` for easy importing

## How It Works

### For New Anime Import:
1. Anime imported from AniList
2. Theme sync triggered for new anime
3. `_save_theme_songs()` creates themes with YouTube URLs
4. `_backfill_missing_youtube_urls()` checks for any missing URLs
5. All themes now have YouTube search URLs

### For Existing Anime:
1. Periodic task runs twice daily
2. Finds themes with empty `youtube_url` field
3. Generates YouTube search URLs
4. Updates themes in database

### URL Format:
Generated URLs are YouTube search URLs like:
```
https://www.youtube.com/results?search_query=Song+Title+by+Artist+Anime+Name+opening
```

## Manual Backfill

If you need to manually backfill URLs immediately:

```bash
# Backfill all themes missing URLs
python manage.py backfill_theme_youtube

# Backfill specific anime
python manage.py backfill_theme_youtube --anime-id 123

# Backfill with limit
python manage.py backfill_theme_youtube --limit 100

# Force re-generate all URLs
python manage.py backfill_theme_youtube --force
```

## Testing

To verify it's working:

1. Check themes in admin or API:
```python
from apps.animes.models import ThemeSong
# Count themes without URLs
ThemeSong.objects.filter(youtube_url="").count()
```

2. Run the periodic task manually:
```python
from apps.animes.tasks import backfill_theme_youtube_urls
backfill_theme_youtube_urls.delay(limit=10)
```

3. Check a specific anime's themes:
```python
from apps.animes.models import Anime
anime = Anime.objects.get(title__icontains="Your Anime")
for theme in anime.theme_songs.all():
    print(f"{theme.title}: {theme.youtube_url}")
```

## Monitoring

The tasks log their progress:
- Theme sync logs: "✓ Synced X themes"
- Backfill logs: "✓ Backfilled Y missing YouTube URLs"
- Periodic task logs: "Starting YouTube URL backfill..." and "Complete! Updated Z themes"

Check Celery logs for any errors during URL generation.

## Future Enhancements (Optional)

To get direct video links instead of search URLs:
1. Get a YouTube Data API key (free tier: 10,000 queries/day)
2. Enhance `_generate_youtube_url()` to call YouTube API
3. Store video IDs instead of search URLs
4. Add embed player support to frontend

Current implementation uses search URLs which work immediately without API keys.
