# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @fincore/web (Next.js)

# Stage 1: Build stage
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ARG INTERNAL_API_URL=http://api:4000
ENV INTERNAL_API_URL=${INTERNAL_API_URL}

RUN npm run build --workspace=@fincore/shared
RUN npm run build --workspace=@fincore/web

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache curl

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

CMD ["npm", "run", "start", "--workspace=apps/web"]
