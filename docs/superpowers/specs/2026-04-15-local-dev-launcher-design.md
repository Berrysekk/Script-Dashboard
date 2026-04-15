# Design: Local Dev Launcher + Comprehensive README

**Date:** 2026-04-15
**Status:** Approved

---

## Overview

Script-Dashboard is a Next.js + FastAPI app designed to run in Docker. This feature adds two cross-platform launcher scripts (`dev.sh`, `dev.ps1`) for running the app locally without Docker, and rewrites the README into a full tutorial covering both local and server deployment.

---

## Section 1 — Launcher Scripts

### `dev.sh` (Mac / Linux)

Location: project root (`./dev.sh`)

Behavior:
- **Prerequisite checks**: verifies `python3` and `node`/`npm` are available; exits with a clear error if not
- **Venv setup**: creates `backend/.venv` if absent, then runs `pip install -r backend/requirements.txt` into it
- **Frontend deps**: runs `npm install` inside `frontend/` only if `node_modules` is missing (skips on subsequent runs for speed)
- **DATA_DIR**: exports `DATA_DIR="$(pwd)/data"` so the backend writes to `./data/` instead of `/data`
- **Process management**: starts uvicorn (`backend/.venv/bin/uvicorn backend.main:app --reload --port 8000`) in the background, captures its PID, then starts Next.js (`npm run dev`) in the foreground
- **Cleanup**: traps `SIGINT`/`SIGTERM`; on exit kills the uvicorn background PID before returning
- **Output**: ANSI-colored status lines (`[backend]`, `[frontend]` prefixes)

### `dev.ps1` (Windows PowerShell)

Location: project root (`.\dev.ps1`)

Behavior:
- **Prerequisite checks**: uses `Get-Command` to verify `python` and `node`/`npm`; exits with `Write-Error` if missing
- **Venv setup**: creates `backend\.venv` if absent, installs requirements via `backend\.venv\Scripts\pip`
- **Frontend deps**: installs npm deps if `frontend\node_modules` is missing
- **DATA_DIR**: sets `$env:DATA_DIR = "$PWD\data"`
- **Process management**: starts uvicorn as a PowerShell background `Start-Job`, stores the job reference; runs Next.js in foreground via `npm run dev` inside a `try/finally` block
- **Cleanup**: `finally` block calls `Stop-Job` + `Remove-Job` on the uvicorn job, ensuring clean exit on Ctrl+C or any error
- **Output**: `Write-Host` with `-ForegroundColor` (Cyan for info, Green for success, Red for errors)

### Shared behaviors

- Both scripts are idempotent: safe to re-run; they skip setup steps already done
- Both create `./data/` if it doesn't exist (the backend does this too, but explicit is clearer)
- Both print the URLs on startup: `http://localhost:3000` (frontend), `http://localhost:8000` (API)
- Neither script modifies any tracked source files

---

## Section 2 — README Rewrite

The existing README (auth-only) is replaced with a full tutorial. Structure:

1. **Overview** — one-paragraph description of what Script-Dashboard does
2. **Prerequisites** — Python 3.10+, Node 18+, Git; links to installers; Windows note about `python` vs `python3`
3. **Quick start — Local PC**
   - Clone the repo
   - Mac/Linux: `chmod +x dev.sh && ./dev.sh`
   - Windows: PowerShell execution policy note + `.\dev.ps1`
   - Where to find first-run credentials (console output)
   - Open `http://localhost:3000`
4. **Configuration** — env vars table (`DATA_DIR`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `MASTER_PASSWORD`) with defaults and purpose
5. **Running on a server (Docker)**
   - `docker compose up -d` using the provided `docker-compose.yml`
   - Volume mapping explanation (`/data`)
   - Port mapping (`7080:80`)
   - Setting env vars for credentials
   - macvlan variant (already in docker-compose, explained)
6. **User management** — admin UI at `/users`, roles
7. **Password recovery & master password rotation** — existing CLI docs cleaned up
8. **Stopping the app**
   - Local: Ctrl+C
   - Docker: `docker compose down`
9. **Troubleshooting**
   - Port already in use (8000 or 3000)
   - `python3` not found on Windows
   - PowerShell execution policy (`Set-ExecutionPolicy RemoteSigned`)
   - Frontend shows API errors: backend not running on port 8000 (Next.js proxies `/api/*` → `127.0.0.1:8000` via `next.config.mjs` rewrites — no CORS involved)

---

## Files Changed

| File | Action |
|---|---|
| `dev.sh` | Create |
| `dev.ps1` | Create |
| `README.md` | Rewrite |

No source files are modified. No new npm/pip dependencies introduced.
