<p align="center">
  <h1 align="center">AniShows</h1>
  <p align="center">
    <strong>A modern, full-stack anime tracking platform</strong>
  </p>
  <p align="center">
    Track your anime journey, share reviews, and connect with the community
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Django-5.2-green?style=flat-square&logo=django" alt="Django">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/Celery-5.3-37814A?style=flat-square&logo=celery" alt="Celery">
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **Anime Tracking** | Manage your watchlist with statuses: Watching, Completed, Plan to Watch, On Hold, Dropped |
| **Reviews & Ratings** | Write detailed reviews with spoiler warnings and sub-ratings (story, animation, music, etc.) |
| **Favorites** | Build your collection of favorite anime |
| **User Profiles** | Customizable profiles with avatars, banners, and bios |
| **Privacy Controls** | Set your profile to private to hide your lists |
| **Secure Auth** | JWT authentication with Google OAuth support |
| **Smart Discovery** | Browse trending, seasonal, upcoming anime with advanced filters |
| **Dark Mode** | Beautiful dark theme with glassmorphism aesthetics |
| **Auto Sync** | Automated data sync from AniList via Celery Beat |
| **Admin Dashboard** | Comprehensive admin panel with site statistics |

---

## Tech Stack

### Backend
- **Framework**: Django 5.2 + Django REST Framework
- **Database**: PostgreSQL 16
- **Cache/Queue**: Redis 7 + Celery
- **Storage**: MinIO (S3-compatible) for media files
- **Auth**: JWT (SimpleJWT) + Django AllAuth

### Frontend
- **Framework**: React 18 (Vite)
- **Styling**: TailwindCSS
- **State**: TanStack Query
- **HTTP**: Axios

### Infrastructure
- **Containerization**: Docker Compose
- **Reverse Proxy**: Caddy (automatic SSL)
- **Background Tasks**: Celery + Celery Beat
- **Backups**: Automated PostgreSQL + MinIO backups

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
- [Make](https://www.gnu.org/software/make/) (optional, for convenience commands)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/oddava/aniShows.git
   cd aniShows
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (database passwords, secret keys, etc.)
   ```

3. **Build and start services**
   ```bash
   make build
   make up
   ```

4. **Initialize the database**
   ```bash
   make mig        # Run migrations
   make superuser  # Create admin account
   ```

5. **Set up MinIO bucket** (required for media storage)
   ```bash
   # Set up MinIO alias
   docker exec anishows-minio-1 mc alias set myminio http://localhost:9000 minioadmin minioadmin
   
   # Create bucket
   docker exec anishows-minio-1 mc mb myminio/anishows-media --ignore-existing
   
   # Set bucket to public
   docker exec anishows-minio-1 mc anonymous set public myminio/anishows-media
   ```

6. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - Admin Panel: http://localhost:8000/admin
   - MinIO Console: http://localhost:9001

---

## Available Commands

```bash
# Service Management
make up              # Start all services
make down            # Stop all services
make restart         # Restart all services
make build           # Build containers
make logs            # Follow all logs
make web-logs        # Follow Django logs
make front-logs      # Follow React logs
make celery-logs     # Follow Celery worker/beat logs

# Django Commands
make mig             # Create and apply migrations
make shell           # Django shell
make superuser       # Create superuser
make test            # Run tests
make collectstatic   # Collect static files

# Data Sync Commands
make sync_trending   # Sync currently trending anime
make sync_seasonal   # Sync current season anime
make sync_upcoming   # Sync next season (upcoming)
make import_anime    # Run full import command
make backfill_metadata # Backfill characters/staff

# Maintenance
make clean           # Remove pyc/pycache files
make prune           # Clean up unused Docker volumes/images

# Backups
make backup          # Create manual backup
make backups         # List all backups
make restore TIMESTAMP=YYYYMMDD_HHMMSS  # Restore from backup
```

Run `make help` for the full list of commands.

---

## Project Structure

```
aniShows/
├── root/                     # Django project settings
│   ├── settings.py           # Main Django configuration
│   ├── celery.py             # Celery configuration & schedules
│   ├── urls.py               # Root URL routing
│   └── storage_backends.py   # S3/MinIO storage config
│
├── api/                      # REST API layer
│   ├── views.py              # API ViewSets (anime, users, reviews, auth)
│   ├── serializers.py        # DRF serializers
│   ├── admin_views.py        # Admin dashboard API endpoints
│   ├── urls.py               # API URL routing
│   └── tests/                # API test suite
│
├── anime/                    # Anime app
│   ├── models.py             # Anime, Genre, Studio, Character, Staff models
│   ├── tasks.py              # Celery tasks (sync, backfill)
│   ├── signals.py            # Post-save signals for metadata fetch
│   ├── filters.py            # Django filter backends
│   └── services/
│       └── anilist.py        # AniList API client & data sync
│
├── users/                    # User management
│   ├── models.py             # CustomUser, UserProfile, UserAnimeList
│   ├── signals.py            # User profile auto-creation
│   ├── adapters.py           # AllAuth adapters for OAuth
│   ├── tasks.py              # User-related background tasks
│   └── management/commands/  # Custom management commands
│
├── reviews/                  # Reviews app (legacy, integrated in anime)
│   └── models.py             # Review model definitions
│
├── core/                     # Core utilities
│   └── management/commands/  # Shared management commands
│
├── frontend/                 # React application
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   │   ├── Navbar.jsx    # Main navigation
│   │   │   ├── AnimeCard.jsx # Anime card with quick actions
│   │   │   ├── ReviewCard.jsx # Review display component
│   │   │   ├── ReviewForm.jsx # Review submission form
│   │   │   └── ...
│   │   ├── pages/            # Page components
│   │   │   ├── Home.jsx      # Landing page
│   │   │   ├── Browse.jsx    # Browse/filter anime
│   │   │   ├── Seasonal.jsx  # Seasonal anime view
│   │   │   ├── AnimeDetail.jsx # Anime detail page
│   │   │   ├── Profile.jsx   # User profile page
│   │   │   ├── Settings.jsx  # User settings
│   │   │   ├── Auth.jsx      # Login/Register
│   │   │   └── admin/        # Admin dashboard pages
│   │   ├── context/          # React contexts (Auth, Theme)
│   │   └── api/              # Axios API client
│   ├── index.html            # Entry HTML
│   ├── tailwind.config.js    # TailwindCSS configuration
│   └── vite.config.js        # Vite build configuration
│
├── docs/                     # Documentation
│   ├── deployment.md         # Production deployment guide
│   ├── scraper.md            # Data sync & MinIO guide
│   └── architecture.md       # Technical architecture overview
│
├── backups/                  # Backup service configuration
│   └── shell/                # Backup/restore scripts
│
├── docker-compose.yml        # Container orchestration
├── Dockerfile                # Django app container
├── Caddyfile                 # Caddy reverse proxy config
├── makefile                  # Development commands
├── pyproject.toml            # Python dependencies (uv)
└── .env.example              # Environment template
```

---

## Docker Services

| Service | Description | Port |
|---------|-------------|------|
| `web` | Django REST API (Gunicorn) | 8000 |
| `frontend` | React dev server (Vite) | 5173 |
| `db` | PostgreSQL 16 database | 5432 |
| `redis` | Redis message broker | 6379 |
| `celery` | Background task worker | - |
| `beat` | Periodic task scheduler | - |
| `minio` | S3-compatible storage | 9000/9001 |
| `backup` | Automated backup service | - |
| `caddy` | Reverse proxy + SSL | 80/443 |

---

## Background Tasks

AniShows uses Celery Beat for automated data synchronization:

| Task | Schedule | Purpose |
|------|----------|---------|
| `sync_trending_anime` | Every hour | Updates trending anime, scores, episode counts |
| `sync_seasonal_anime` | Daily @ 4:00 AM UTC | Fetches current season anime |
| `sync_next_season_anime` | Weekly (Sunday @ 5:00 AM UTC) | Fetches upcoming season anime |
| `fetch_deep_metadata` | On-demand (signal) | Fetches characters/staff for new anime |

---

## Security Features

- JWT-based authentication with token refresh
- Password hashing with Django's PBKDF2
- XSS protection via HTML escaping
- CSRF protection enabled
- File upload validation (size & type limits)
- Object-level permissions (users can only modify their own data)
- Production security headers when DEBUG=False
- Automatic HTTPS via Caddy

---

## Documentation

- [Deployment Guide](docs/deployment.md) - Production deployment on AWS EC2
- [Scraper & Storage Guide](docs/scraper.md) - Data sync and MinIO setup
- [Architecture Overview](docs/architecture.md) - Technical design and decisions

---

## Deployment

For production deployment instructions, see the [Deployment Guide](docs/deployment.md).

Key production considerations:
- Set `DEBUG=False` and generate a secure `DJANGO_SECRET_KEY`
- Configure SSL/HTTPS via Caddy (automatic with valid domain)
- Use environment variables for all secrets
- Enable production security settings

---

## Testing

```bash
# Run all tests
make test

# Run specific test file
docker compose exec web uv run python manage.py test api.tests.test_auth
```

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Code Style
- Python: Follow PEP 8
- JavaScript: Use ESLint + Prettier defaults
- Commit messages: Use conventional commits format

---

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## Author

**oddava** - [GitHub](https://github.com/oddava)

---

<p align="center">
  Made with ❤️ for anime fans
</p>
