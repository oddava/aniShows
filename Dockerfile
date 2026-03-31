FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev


FROM python:3.12-slim AS dev-builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --extra dev


FROM python:3.12-slim AS runtime

RUN useradd -m -u 1000 aniuser

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libmagic1 \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH"

COPY . .

RUN DJANGO_SETTINGS_MODULE=root.settings.production \
    DJANGO_SECRET_KEY=collectstatic-placeholder \
    CORS_ALLOWED_ORIGINS=https://placeholder.com \
    CSRF_TRUSTED_ORIGINS=https://placeholder.com \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    DB_HOST=localhost \
    DB_PORT=5432 \
    python manage.py collectstatic --noinput

RUN chown -R aniuser:aniuser /app

USER aniuser

EXPOSE 8000 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health/ || exit 1

CMD ["gunicorn", "root.asgi:application", "-c", "gunicorn.conf.py"]


FROM runtime AS development

USER root
COPY --from=dev-builder /app/.venv /app/.venv
RUN chown -R aniuser:aniuser /app/.venv
USER aniuser
