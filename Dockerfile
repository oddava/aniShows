# One base for every stage, pinned by digest (bump deliberately: docker pull
# python:3.12-slim && docker image inspect --format '{{json .RepoDigests}}').
ARG PYTHON_IMAGE=python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

FROM ${PYTHON_IMAGE} AS builder

WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev


FROM ${PYTHON_IMAGE} AS dev-builder

WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --extra dev


FROM ${PYTHON_IMAGE} AS runtime

# The commit this image was built from (CI: --build-arg GIT_SHA=...): Sentry's
# release and what a deploy can check is serving.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
# deploy-prod.sh prunes only images carrying this label (shared host).
LABEL app.anishows.component="backend" \
      org.opencontainers.image.revision="${GIT_SHA}"

RUN useradd -m -u 1000 aniuser

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libmagic1 \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

RUN python -c "import PIL"

COPY --chown=aniuser:aniuser . .

RUN find /app -type f -name "*.sh" -exec sed -i 's/\r$//' {} +

# collectstatic, then the production system checks with a throwaway random key
# (deploy-time values are checked again by deploy-prod.sh). Errors fail the
# build; warnings (no Safe Browsing key, ...) are printed.
RUN export DJANGO_SETTINGS_MODULE=root.settings.production \
    DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(64))')" \
    ALLOWED_HOSTS=build.invalid \
    CORS_ALLOWED_ORIGINS=https://placeholder.com \
    CSRF_TRUSTED_ORIGINS=https://placeholder.com \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    DB_HOST=localhost \
    DB_PORT=5432 \
    && python manage.py collectstatic --noinput \
    && python manage.py check --deploy --fail-level ERROR \
    && chown aniuser:aniuser /app \
    && chown -R aniuser:aniuser /app/static

USER aniuser

EXPOSE 8000 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health/ || exit 1

CMD ["bash", "/app/scripts/run_with_migration_check.sh", "gunicorn", "root.asgi:application", "-c", "gunicorn.conf.py"]


FROM runtime AS development

USER root
COPY --from=dev-builder --chown=aniuser:aniuser /opt/venv /opt/venv
USER aniuser


# Keep production last so a build without --target never ships dev dependencies.
FROM runtime AS production
