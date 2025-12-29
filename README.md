# AniShows

**AniShows** is a modern, full-featured anime tracking and social platform. It allows users to track their anime watching progress, manage lists (Watching, Completed, Plan to Watch), favorite series, write reviews, and customize their profiles with avatars and banners.

## 🚀 Key Features

*   **Modern UI**: Built with **React** and **TailwindCSS**, featuring dark mode, glassmorphism aesthetics, and smooth animations.
*   **Anime Tracking**: Manage your anime list with statuses (Watching, Completed, On Hold, Dropped, Plan to Watch) and track episode progress.
*   **Social & Profile**:
    *   Customizable User Profiles (Avatar, Banner, Bio).
    *   Rich statistics (Reviews, Favorites count).
    *   **Google OAuth** integration for easy login/signup.
*   **Discovery**:
    *   Trending, Top Rated, and Newest anime lists.
    *   Advanced filtering by Genre, Status, and Type.
    *   Intelligent search.
*   **Robust Backend**: Powered by **Django Rest Framework** with **PostgreSQL** for data and **Redis** for caching/queues.
*   **Media Storage**: **MinIO** (S3-compatible) storage for handling user uploads and anime assets efficiently.
*   **Backup System**: Automated daily and weekly backups for Database and Media.

## 🛠️ Tech Stack

*   **Frontend**: React (Vite), TailwindCSS, Lucide Icons, TanStack Query, Axios.
*   **Backend**: Python, Django, Django Rest Framework (DRF).
*   **Auth**: JWT (SimpleJWT), Django AllAuth (Google OAuth).
*   **Database**: PostgreSQL 18.
*   **Cache/Broker**: Redis 7.
*   **Storage**: MinIO (S3 Compatible).
*   **Task Queue**: Celery & Celery Beat.
*   **Infrastructure**: Docker Compose, Alpine Linux.

## 📋 Prerequisites

*   [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
*   [Make](https://www.gnu.org/software/make/) (Optional, but recommended for easy commands)

## ⚡ Getting Started

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/oddava/aniShows.git
    cd aniShows
    ```

2.  **Environment Setup**:
    Copy the example environment file and configure it:
    ```bash
    cp .env.example .env/.env.prod
    # Edit .env/.env.prod with your credentials (DB password, Secret Keys, etc.)
    ```
    *Note: For local development, `settings.py` is configured to use `localhost:9000` for MinIO unless `MINIO_PUBLIC_DOMAIN` is set.*

3.  **Build and Run**:
    ```bash
    make build
    make up
    ```
    The application will be accessible at:
    *   **Frontend**: `http://localhost:5173`
    *   **Backend API**: `http://localhost:8000`
    *   **MinIO Console**: `http://localhost:9001`

4.  **Initial Setup**:
    ```bash
    # Apply Migrations
    make mig
    
    # Create Superuser
    make superuser
    ```

## 🧰 Development Commands

A `makefile` is provided to simplify common tasks:

| Command | Description |
| :--- | :--- |
| `make up` | Start all services in background |
| `make down` | Stop all services |
| `make logs` | Follow logs for all services |
| `make web-logs` | Follow Backend logs only |
| `make front-logs` | Follow Frontend logs only |
| `make mig` | Run `makemigrations` and `migrate` |
| `make shell` | Open Django shell |
| `make test` | Run tests |

Run `make help` to see all available commands.

## 💾 Backup & Restore

The project includes a dedicated `backup` service using `pg_dump` and `tar`.

*   **Automated Backups**: Runs Daily (3 AM) and Weekly (Sunday 4 AM).
*   **Manual Backup**:
    ```bash
    make backup
    ```
*   **List Backups**:
    ```bash
    make backups
    ```
*   **Restore**:
    ```bash
    make restore TIMESTAMP=YYYYMMDD_HHMMSS
    ```
    *(Note: Restore will wipe the current database public schema before restoring to ensure a clean state.)*

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
