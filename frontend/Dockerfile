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
ARG ALLOWED_HOSTS
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
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
ARG ALLOWED_HOSTS
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1}
ENV NODE_ENV=production

# Copy source code (this layer is cached by content hash)
COPY . .

# BUILD_DATE declared AFTER COPY to bust cache for npm run build
# when a new commit is deployed, even if source files haven't changed
ARG BUILD_DATE
ENV BUILD_DATE=${BUILD_DATE}

# Build production assets (always re-runs when BUILD_DATE changes)
RUN npm run build

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
