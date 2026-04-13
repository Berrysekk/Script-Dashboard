# ── Stage 1: Build Next.js ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim

# Install system deps: nginx, supervisord, Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
      nginx supervisor curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
COPY backend/ backend/

# Copy built Next.js artifacts from stage 1
COPY --from=frontend-builder /app/frontend/.next          frontend/.next
COPY --from=frontend-builder /app/frontend/public         frontend/public
COPY --from=frontend-builder /app/frontend/node_modules   frontend/node_modules
COPY --from=frontend-builder /app/frontend/package.json   frontend/package.json
COPY --from=frontend-builder /app/frontend/next.config.ts frontend/next.config.ts

# Config files
COPY nginx.conf       /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Data volume for scripts, logs, and SQLite DB
VOLUME ["/data"]
EXPOSE 80
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
