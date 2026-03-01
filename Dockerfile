FROM python:3.12-slim

RUN useradd -m -u 1000 aniuser

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libmagic1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

COPY . .

# Collect static files for whitenoise to serve in production
RUN DJANGO_SETTINGS_MODULE=root.settings.production \
    DJANGO_SECRET_KEY=collectstatic-placeholder \
    CORS_ALLOWED_ORIGINS=https://placeholder.com \
    CSRF_TRUSTED_ORIGINS=https://placeholder.com \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    DB_HOST=localhost \
    DB_PORT=5432 \
    uv run python manage.py collectstatic --noinput

RUN chown -R aniuser:aniuser /app

USER aniuser

EXPOSE 8000

CMD ["uv", "run", "gunicorn", "root.wsgi:application", \
    "--bind", "0.0.0.0:8000", \
    "--workers", "4", \
    "--worker-class", "gthread", \
    "--threads", "4", \
    "--worker-connections", "1000", \
    "--max-requests", "1000", \
    "--max-requests-jitter", "50", \
    "--timeout", "60", \
    "--keep-alive", "5", \
    "--access-logfile", "-", \
    "--error-logfile", "-", \
    "--log-level", "info", \
    "--preload"]
