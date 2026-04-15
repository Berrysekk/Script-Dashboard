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
      nginx supervisor curl firejail \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create an unprivileged user for the FastAPI + Next.js workers. nginx
# keeps its own 'www-data' user for worker processes but the master must
# start as root to bind :80 — supervisord handles that for us and drops
# privileges per-program (see supervisord.conf).
RUN groupadd --system --gid 1001 appuser \
    && useradd  --system --uid 1001 --gid appuser --home /home/appuser \
        --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
COPY backend/ backend/

# Copy built Next.js artifacts from stage 1
COPY --from=frontend-builder /app/frontend/.next          frontend/.next
COPY --from=frontend-builder /app/frontend/public/.       frontend/public/
COPY --from=frontend-builder /app/frontend/node_modules   frontend/node_modules
COPY --from=frontend-builder /app/frontend/package.json   frontend/package.json
COPY --from=frontend-builder /app/frontend/next.config.mjs frontend/next.config.mjs

# Config files
COPY nginx.conf       /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Prepare writable dirs owned by the unprivileged user. /data is the
# mounted volume — entries created here are just a placeholder to survive
# a bind mount without a pre-chowned host directory.
RUN mkdir -p /data /var/log/app \
    && chown -R appuser:appuser /app /data /var/log/app

# Data volume for scripts, logs, and SQLite DB
VOLUME ["/data"]
EXPOSE 80
# supervisord starts as root (nginx master needs it to bind :80) and
# drops privileges to appuser for FastAPI + Next.js, see supervisord.conf.
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
