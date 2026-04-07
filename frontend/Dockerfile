# Multi-stage Dockerfile for React frontend
# Supports both development and production builds

# ============================================================================
# Base stage - Dependencies
# ============================================================================
FROM node:20-alpine AS base

WORKDIR /app

# Copy package files
COPY package*.json .npmrc* ./

# Install dependencies
RUN npm ci

# ============================================================================
# Development stage
# ============================================================================
FROM base AS development

ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_UMAMI_SCRIPT_URL
ARG VITE_UMAMI_WEBSITE_ID
ARG VITE_SENTRY_DSN
ARG VITE_ENVIRONMENT
ARG ALLOWED_HOSTS
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_UMAMI_SCRIPT_URL=${VITE_UMAMI_SCRIPT_URL}
ENV VITE_UMAMI_WEBSITE_ID=${VITE_UMAMI_WEBSITE_ID}
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_ENVIRONMENT=${VITE_ENVIRONMENT:-development}
ENV ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1}

# Copy source code
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ============================================================================
# Production builder stage
# ============================================================================
FROM base AS builder

ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_UMAMI_SCRIPT_URL
ARG VITE_UMAMI_WEBSITE_ID
ARG VITE_SENTRY_DSN
ARG VITE_ENVIRONMENT
ARG ALLOWED_HOSTS
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_UMAMI_SCRIPT_URL=${VITE_UMAMI_SCRIPT_URL}
ENV VITE_UMAMI_WEBSITE_ID=${VITE_UMAMI_WEBSITE_ID}
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV VITE_ENVIRONMENT=${VITE_ENVIRONMENT:-production}
ENV ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1}
ENV NODE_ENV=production

# Copy source code (this layer is cached by content hash)
COPY . .

# BUILD_DATE declared AFTER COPY to bust cache for npm run build
# when a new commit is deployed, even if source files haven't changed
ARG BUILD_DATE
ENV BUILD_DATE=${BUILD_DATE}

# Build production assets (always re-runs when BUILD_DATE changes)
RUN npm run build && \
    echo "Build completed, checking output..." && \
    ls -la /app/dist/ && \
    test -f /app/dist/index.html || (echo "ERROR: index.html not found!" && exit 1) && \
    test -d /app/dist/assets || (echo "ERROR: assets directory not found!" && exit 1) && \
    echo "Build verification passed!"

# ============================================================================
# Production stage - Serve static files (optional, Caddy serves them directly)
# ============================================================================
FROM nginx:alpine AS production

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
