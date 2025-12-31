<p align="center">
  <h1 align="center">🎬 AniShows</h1>
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
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📺 **Anime Tracking** | Manage your watchlist with statuses: Watching, Completed, Plan to Watch, On Hold, Dropped |
| ⭐ **Reviews & Ratings** | Write detailed reviews with spoiler warnings and 1-10 ratings |
| 💜 **Favorites** | Build your collection of favorite anime |
| 👤 **User Profiles** | Customizable profiles with avatars, banners, and bios |
| 🔒 **Privacy Controls** | Set your profile to private to hide your lists |
| 🔐 **Secure Auth** | JWT authentication with Google OAuth support |
| 🔍 **Smart Discovery** | Filter by genre, status, type + trending and top-rated sections |
| 🌙 **Dark Mode** | Beautiful dark theme with glassmorphism aesthetics |

---

## 🛠️ Tech Stack

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
- **Reverse Proxy**: Nginx (production)
- **CI/CD**: GitHub Actions (optional)

---

## 🚀 Quick Start

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

5. **Access the application**
   - 🌐 Frontend: http://localhost:5173
   - 🔧 Backend API: http://localhost:8000
   - 📊 Admin Panel: http://localhost:8000/admin
   - 💾 MinIO Console: http://localhost:9001

---

## 📋 Available Commands

```bash
make up              # Start all services
make down            # Stop all services
make logs            # Follow all logs
make web-logs        # Follow Django logs
make front-logs      # Follow React logs

make mig             # Create and apply migrations
make shell           # Django shell
make test            # Run tests

make backup          # Create manual backup
make backups         # List all backups
make restore TIMESTAMP=YYYYMMDD_HHMMSS  # Restore from backup
```

Run `make help` for the full list of commands.

---

## 🏗️ Project Structure

```
aniShows/
├── api/              # REST API views, serializers, URLs
├── anime/            # Anime models, AniList sync service
├── users/            # User models, authentication
├── reviews/          # Review models (legacy, see anime.Review)
├── core/             # Core utilities and management commands
├── frontend/         # React application
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── context/      # React contexts
│   │   └── api/          # API client
├── docs/             # Documentation
├── backups/          # Backup service configuration
└── docker-compose.yml
```

---

## 🔒 Security Features

- ✅ JWT-based authentication with token refresh
- ✅ Password hashing with Django's PBKDF2
- ✅ XSS protection via HTML escaping
- ✅ CSRF protection enabled
- ✅ File upload validation (size & type limits)
- ✅ Object-level permissions (users can only modify their own data)
- ✅ Production security headers when DEBUG=False

---

## 🚢 Deployment

For production deployment instructions, see the [Deployment Guide](docs/deployment.md).

Key production considerations:
- Set `DEBUG=False` and generate a secure `DJANGO_SECRET_KEY`
- Configure SSL/HTTPS with Nginx + Certbot
- Use environment variables for all secrets
- Enable production security settings

---

## 🧪 Testing

```bash
# Run all tests
make test

# Run specific test file
docker compose exec web uv run python manage.py test api.tests.test_auth
```

---

## 🤝 Contributing

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

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**oddava** - [GitHub](https://github.com/oddava)

---

<p align="center">
  Made with ❤️ for anime fans everywhere
</p>
