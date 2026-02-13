FROM python:3.12-slim

# Create non-root user early
RUN useradd -m -u 1000 aniuser

WORKDIR /app

# Install system dependencies in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libmagic1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Copy only dependency files first for better caching
COPY pyproject.toml uv.lock ./

# Install Python dependencies
RUN uv sync --frozen --no-dev

# Copy the rest of the application
COPY . .

# Set proper permissions
RUN chown -R aniuser:aniuser /app

USER aniuser

EXPOSE 8000

# Production-grade Gunicorn configuration
# Workers: 4 (2-4x CPU cores)
# Threads: 4 per worker for handling concurrent requests
# Worker class: gthread (thread-based async)
# Max requests: 1000 before worker restart (prevents memory leaks)
# Timeout: 60s for long-running requests
# Keep-alive: 5s for connection reuse
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
