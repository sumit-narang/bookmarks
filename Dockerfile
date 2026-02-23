# Dockerfile for bookmarks backend deployment on Fly.io
# Uses Node 22 for built-in node:sqlite support.

FROM node:22-slim

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/mobile/package.json apps/mobile/package.json

# Install workspace dependencies (production only, skip optional/mobile-heavy deps)
RUN npm install --omit=dev --ignore-scripts 2>/dev/null; \
    npm install tsx --save-dev 2>/dev/null; \
    true

# Copy source modules needed by the backend
COPY apps/backend/ apps/backend/
COPY core/ core/
COPY schema/ schema/
COPY db/ db/
COPY auth/ auth/
COPY http/ http/
COPY sync/ sync/
COPY share/ share/
COPY places/ places/
COPY collections/ collections/
COPY preferences/ preferences/
COPY tsconfig.json tsconfig.base.json ./

# Create data directory for SQLite
RUN mkdir -p /data

ENV NODE_ENV=production
ENV BOOKMARKS_BACKEND_HOST=0.0.0.0
ENV BOOKMARKS_BACKEND_PORT=8080
ENV BOOKMARKS_BACKEND_DB_PATH=/data/backend.sqlite

EXPOSE 8080

CMD ["npx", "tsx", "apps/backend/src/index.ts"]
