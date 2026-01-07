# AniShows Architecture

This document provides a technical overview of the AniShows platform architecture, design decisions, and data flow.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Backend Architecture](#backend-architecture)
3. [Frontend Architecture](#frontend-architecture)
4. [Data Models](#data-models)
5. [API Design](#api-design)
6. [Background Processing](#background-processing)
7. [Storage Strategy](#storage-strategy)
8. [Authentication Flow](#authentication-flow)

---

## System Overview

AniShows is a full-stack anime tracking platform built with a microservices-oriented Docker architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Caddy (Reverse Proxy)                   │
│                    Port 80/443 - Auto SSL                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Frontend      │  │   Backend API   │  │   MinIO         │
│   React + Vite  │  │   Django DRF    │  │   S3 Storage    │
│   Port 5173     │  │   Port 8000     │  │   Port 9000     │
└────────┬────────┘  └────────┬────────┘  └─────────────────┘
         │                    │
         │           ┌────────┴────────┐
         │           │                 │
         │           ▼                 ▼
         │   ┌─────────────┐   ┌─────────────┐
         │   │  PostgreSQL │   │    Redis    │
         │   │  Port 5432  │   │  Port 6379  │
         │   └─────────────┘   └──────┬──────┘
         │                            │
         │                    ┌───────┴───────┐
         │                    │               │
         │                    ▼               ▼
         │            ┌─────────────┐  ┌─────────────┐
         │            │   Celery    │  │   Celery    │
         │            │   Worker    │  │   Beat      │
         │            └─────────────┘  └─────────────┘
         │
         └──────────────── API Calls ──────────────────
```

---

## Backend Architecture

### Django Apps

| App | Responsibility |
|-----|----------------|
| `root` | Project configuration, settings, Celery setup |
| `api` | REST API endpoints, serializers, request handling |
| `anime` | Anime models, AniList sync service, filters |
| `users` | User authentication, profiles, anime lists |
| `reviews` | Review models (integrated with anime) |
| `core` | Shared utilities and management commands |

### Request Flow

```
HTTP Request
     │
     ▼
┌─────────────────┐
│   Caddy/Nginx   │  ← SSL termination, routing
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Gunicorn      │  ← WSGI server (4 workers)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Django        │  ← Middleware chain
│   Middleware    │     - CORS
│                 │     - Authentication
│                 │     - CSRF
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   DRF ViewSet   │  ← Request handling
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Serializer    │  ← Data validation/serialization
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Model/ORM     │  ← Database operations
└─────────────────┘
```

---

## Frontend Architecture

### Component Structure

```
src/
├── components/           # Reusable UI components
│   ├── Navbar.jsx       # Global navigation with search
│   ├── AnimeCard.jsx    # Card with quick actions (list, favorite)
│   ├── ReviewCard.jsx   # Review display with spoiler handling
│   ├── ReviewForm.jsx   # Multi-field review submission
│   └── StatusSelector.jsx # Watchlist status dropdown
│
├── pages/               # Route-level components
│   ├── Home.jsx        # Landing with trending/seasonal sections
│   ├── Browse.jsx      # Advanced filtering & sorting
│   ├── AnimeDetail.jsx # Full anime info with tabs
│   ├── Profile.jsx     # User profile with lists
│   └── admin/          # Admin dashboard
│
├── context/            # React Context providers
│   └── AuthContext.jsx # Authentication state
│
└── api/                # API client
    └── axios.js        # Configured Axios instance
```

### State Management

- **Server State**: TanStack Query for API data caching and synchronization
- **Auth State**: React Context for user session management
- **Local State**: useState/useReducer for component-level state

### Key Patterns

1. **Optimistic Updates**: List actions (add to watchlist) update UI immediately
2. **Infinite Scroll**: Browse page uses cursor-based pagination
3. **Dynamic Accent Colors**: Anime detail pages extract colors from cover images
4. **Responsive Design**: Mobile-first approach with Tailwind breakpoints

---

## Data Models

### Core Entities

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Anime     │──────<│ AnimeCharacter│>─────│  Character  │
│             │       │   (role)    │       │             │
└──────┬──────┘       └─────────────┘       └─────────────┘
       │                                           │
       │              ┌─────────────┐              │
       └─────────────<│ AnimeStaff  │>─────────────┘
                      │  (role)     │       ┌─────────────┐
                      └─────────────┘       │   Staff     │
                                            │ (VA, Dir)   │
                                            └─────────────┘
```

### User Models

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ CustomUser  │──────<│ UserProfile │       │ UserAnimeList│
│ (Django)    │       │ (avatar,bio)│       │(status,score)│
└──────┬──────┘       └─────────────┘       └──────┬──────┘
       │                                           │
       │              ┌─────────────┐              │
       └─────────────<│ UserFavorite│>─────────────┘
                      └─────────────┘        ┌──────▼──────┐
                                             │   Anime     │
                                             └─────────────┘
```

### Review Model

Reviews include sub-ratings for granular feedback:
- Overall rating (1-10)
- Story rating
- Animation rating
- Music rating
- Character rating
- Spoiler flag
- Like count

---

## API Design

### Endpoints Overview

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/anime/` | GET | List/filter anime |
| `/api/anime/{slug}/` | GET | Anime detail |
| `/api/anime/trending/` | GET | Trending anime |
| `/api/anime/top-rated/` | GET | Top rated anime |
| `/api/anime/{slug}/reviews/` | GET | Anime reviews |
| `/api/genres/` | GET | All genres |
| `/api/studios/` | GET | All studios |
| `/api/user/profile/` | GET, PATCH | Current user profile |
| `/api/user/list/` | GET, POST, DELETE | User anime list |
| `/api/user/favorites/` | GET, POST, DELETE | User favorites |
| `/api/reviews/` | GET, POST | Reviews CRUD |
| `/api/auth/login/` | POST | JWT login |
| `/api/auth/register/` | POST | User registration |
| `/api/auth/google/` | POST | Google OAuth |

### Filtering & Pagination

The anime list endpoint supports:
- **Filters**: genre, status, type, year, season
- **Search**: Full-text search on title
- **Sorting**: rating, popularity, release_date, title
- **Pagination**: Page-based (`?page=2&page_size=24`)

---

## Background Processing

### Celery Configuration

```python
# Task Queues
CELERY_TASK_QUEUES = {
    'default': {'priority': 10},     # High-priority (trending sync)
    'low_priority': {'priority': 1}, # Background (metadata backfill)
}

# Schedules (Celery Beat)
CELERY_BEAT_SCHEDULE = {
    'sync-trending-every-hour': {
        'task': 'anime.tasks.sync_trending_anime',
        'schedule': crontab(minute=0),
    },
    'sync-seasonal-daily': {
        'task': 'anime.tasks.sync_seasonal_anime',
        'schedule': crontab(hour=4, minute=0),
    },
    'sync-next-season-weekly': {
        'task': 'anime.tasks.sync_next_season_anime',
        'schedule': crontab(hour=5, minute=0, day_of_week=0),
    },
}
```

### Task Types

1. **Sync Tasks**: Fetch data from AniList API
   - `sync_trending_anime`: Updates currently popular anime
   - `sync_seasonal_anime`: Fetches current season catalog
   - `sync_next_season_anime`: Pre-populates upcoming anime

2. **Event-Driven Tasks**: Triggered by Django signals
   - `fetch_deep_metadata`: Called on new anime creation, fetches characters/staff

3. **Batch Tasks**: Manual or scheduled bulk operations
   - `backfill_catalog`: Imports historical anime data
   - `backfill_metadata_task`: Enriches existing anime records

### Data Flow (AniList Sync)

```
Celery Beat (schedule)
        │
        ▼
┌─────────────────┐
│  sync_*_anime   │  ← Task triggered
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AniListService  │  ← GraphQL API calls (rate-limited)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Anime.objects  │  ← Create/Update records
│  .update_or_create │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ post_save signal│  ← Trigger metadata fetch
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│fetch_deep_metadata│ ← Characters, Staff, VA data
└─────────────────┘
```

---

## Storage Strategy

### MinIO (S3-Compatible)

All user-uploaded and scraped media is stored in MinIO:

- **Bucket**: `anishows-media`
- **Structure**:
  ```
  anishows-media/
  ├── avatars/          # User profile pictures
  ├── banners/          # User banner images
  ├── covers/           # Anime cover images
  ├── characters/       # Character images
  └── staff/            # Staff/VA images
  ```

### Storage Configuration

```python
# settings.py
if USE_S3:
    DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
    AWS_S3_ENDPOINT_URL = os.getenv('AWS_S3_ENDPOINT_URL')
    AWS_STORAGE_BUCKET_NAME = os.getenv('AWS_STORAGE_BUCKET_NAME')
```

---

## Authentication Flow

### JWT Authentication

```
┌─────────────┐     POST /api/auth/login/     ┌─────────────┐
│   Client    │ ─────────────────────────────>│   Backend   │
│             │     {email, password}         │             │
└─────────────┘                               └──────┬──────┘
                                                     │
                                                     ▼
                                              ┌─────────────┐
                                              │  Validate   │
                                              │ Credentials │
                                              └──────┬──────┘
                                                     │
┌─────────────┐     {access, refresh}         ┌──────▼──────┐
│   Client    │ <─────────────────────────────│ JWT Tokens  │
│   (store)   │                               │  Generated  │
└──────┬──────┘                               └─────────────┘
       │
       │  Subsequent requests:
       │  Authorization: Bearer <access_token>
       │
       ▼
┌─────────────┐
│  Protected  │
│  Endpoints  │
└─────────────┘
```

### Google OAuth Flow

```
1. Frontend redirects to Google OAuth consent page
2. Google redirects back with authorization code
3. Frontend sends code to /api/auth/google/
4. Backend exchanges code for Google tokens
5. Backend creates/updates user, returns JWT tokens
6. Frontend stores tokens, user is logged in
```

---

## Performance Considerations

1. **Database Indexing**: Key fields (status, rating, release_date) are indexed
2. **Queryset Optimization**: `select_related` and `prefetch_related` for N+1 prevention
3. **Caching**: Redis caches expensive queries (trending, seasonal)
4. **Pagination**: All list endpoints are paginated (24 items default)
5. **Image Optimization**: CDN-ready URLs via MinIO public access
6. **Lazy Loading**: Frontend uses intersection observer for images

---

## Future Considerations

- [ ] GraphQL API for more flexible querying
- [ ] WebSocket support for real-time notifications
- [ ] Full-text search with Elasticsearch
- [ ] Rate limiting on public endpoints
- [ ] Multi-language support (i18n)
