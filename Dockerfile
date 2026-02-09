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

CMD ["uv", "run", "gunicorn", "root.wsgi:application", "--bind", "0.0.0.0:8000", "--access-logfile", "-"]
