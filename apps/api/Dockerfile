# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @fincore/api

# Stage 1: Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies required for native build tools if any
RUN apk add --no-cache python3 make g++

# Copy root configuration and lockfiles
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package first, then api
RUN npm run build --workspace=@fincore/shared
RUN npm run build --workspace=@fincore/api

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package descriptors for production install
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY docs/openapi.json ./docs/openapi.json

# Secure unprivileged user
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
