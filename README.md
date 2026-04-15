# Script Dashboard

A self-hosted web dashboard for managing, running, and monitoring Python scripts. Features include loop scheduling, real-time log streaming, output download, role-based access control, and user management — all in a clean UI.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start — Local PC](#quick-start--local-pc)
- [Running on a Server (Docker)](#running-on-a-server-docker)
- [Configuration](#configuration)
- [User Management](#user-management)
- [Password Recovery](#password-recovery)
- [Rotating the Master Password](#rotating-the-master-password)
- [Stopping the App](#stopping-the-app)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Local PC

| Tool | Minimum version | Download |
|------|----------------|---------|
| Python | 3.10 | https://python.org/downloads |
| Node.js | 18 | https://nodejs.org |
| Git | any | https://git-scm.com |

> **Windows note:** the launcher expects the Python executable to be named `python`. The official installer adds this automatically — make sure you tick **"Add Python to PATH"** during installation.

### Server (Docker)

| Tool | Download |
|------|---------|
| Docker Engine | https://docs.docker.com/engine/install |
| Docker Compose v2 | included with Docker Desktop; on Linux install the `docker-compose-plugin` |

---

## Quick Start — Local PC

These scripts set up a Python virtual environment, install all dependencies, and start both the backend (FastAPI) and frontend (Next.js) automatically. Data is stored in a `./data/` folder inside the repo — nothing is written outside the project directory.

### Mac / Linux

```bash
git clone https://github.com/berrysekk/script-dashboard.git
cd script-dashboard
chmod +x dev.sh
./dev.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/berrysekk/script-dashboard.git
cd script-dashboard
.\dev.ps1
```

> **First time on Windows?** PowerShell may block local scripts by default. Run this once in an admin PowerShell window, then retry:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

### After the script starts

Both services print their URLs once everything is ready:

```
┌─────────────────────────────────────────────┐
│  Frontend  →  http://localhost:3000          │
│  API       →  http://localhost:8000          │
│  Ctrl+C to stop both                         │
└─────────────────────────────────────────────┘
```

Open **http://localhost:3000** in your browser.

### First-run credentials

On the very first start the app generates an admin account and a master password, then prints them to the console **once**:

```
[info] Bootstrap: admin account created — username: admin  password: <generated>
[info] Bootstrap: master password written to data/master_password.hash — value: <generated>
```

Copy both values somewhere safe before closing the terminal. If you miss them, see [Password Recovery](#password-recovery).

You can also set credentials before first start using environment variables — see [Configuration](#configuration).

### Subsequent runs

The `dev.sh` / `dev.ps1` scripts are idempotent. Re-running them skips venv creation and dependency installation, so startup is fast after the first run.

---

## Running on a Server (Docker)

The project ships with a `docker-compose.yml` ready for self-hosted servers and Unraid.

### 1. Clone and configure

```bash
git clone https://github.com/berrysekk/script-dashboard.git
cd script-dashboard
```

Open `docker-compose.yml` and set your preferred credentials (optional — the app generates them if omitted):

```yaml
environment:
  ADMIN_USERNAME: admin
  ADMIN_PASSWORD: change-me
  MASTER_PASSWORD: pick-something-long-and-random
```

> Credentials are consumed **only on first start** (when no database exists). Changing them in the compose file after the first start has no effect — use the UI or CLI instead.

### 2. Start the container

```bash
docker compose up -d
```

The dashboard is now available at **http://\<server-ip\>:7080**.

### Volumes

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `/mnt/user/appdata/script-dashboard` | `/data` | SQLite database, scripts, and logs |

Change the host path in `docker-compose.yml` to wherever you want data stored:

```yaml
volumes:
  - /your/chosen/path:/data
```

### macvlan (own IP on the network)

If you want the dashboard to have its own IP address instead of a port on the host, uncomment the `macvlan` section at the bottom of `docker-compose.yml` and set a free IP on your LAN:

```yaml
networks:
  br0_macvlan:
    ipv4_address: 192.168.1.100   # ← pick a free IP
```

---

## Configuration

All configuration is done through environment variables. For local dev, prefix the `dev.sh` command or set them in your shell before running the script. For Docker, add them under `environment:` in `docker-compose.yml`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATA_DIR` | `/data` (Docker) / `./data` (local) | Directory for the database, scripts, and logs |
| `ADMIN_USERNAME` | `admin` | Username of the first admin account |
| `ADMIN_PASSWORD` | *auto-generated* | Password for the first admin. Generated and printed once on first start if not set |
| `MASTER_PASSWORD` | *auto-generated* | Shared recovery secret used by the "Forgot password?" flow. Generated and printed once on first start if not set |

**Example — local dev with custom credentials:**

```bash
ADMIN_USERNAME=jan ADMIN_PASSWORD=hunter2 ./dev.sh
```

**Example — Docker with a custom data path:**

```yaml
services:
  dashboard:
    image: ghcr.io/berrysekk/script-dashboard:latest
    ports:
      - "7080:80"
    volumes:
      - /opt/script-dashboard:/data
    environment:
      ADMIN_USERNAME: jan
      ADMIN_PASSWORD: hunter2
      MASTER_PASSWORD: very-long-random-string
    restart: unless-stopped
```

---

## User Management

Admins can manage users at **/users** in the web UI:

- Create, edit, and delete users
- Assign roles (`admin` or `user`)
- Control which scripts each role can see and run

---

## Password Recovery

If you forget your password, use the **Forgot password?** link on the login page:

1. Enter your username
2. Enter the master password (the one generated on first start, or set via `MASTER_PASSWORD`)
3. Enter and confirm a new password

The master password is a root-equivalent shared secret — store it offline.

---

## Rotating the Master Password

The master password cannot be changed through the web UI by design — a compromised dashboard session can't replace your recovery secret.

To rotate it, open a shell and run:

**Docker:**
```bash
docker exec -it script-dashboard python -m backend.cli set-master-password
```

**Local:**
```bash
backend/.venv/bin/python -m backend.cli set-master-password
```

The CLI prompts for the new password twice and rewrites the hash file immediately.

### Emergency: reset a user without knowing the master password

If all admins are locked out and the master password is lost, you can reset a specific user directly:

**Docker:**
```bash
docker exec -it script-dashboard python -m backend.cli reset-password admin
```

**Local:**
```bash
backend/.venv/bin/python -m backend.cli reset-password admin
```

---

## Stopping the App

**Local:**

Press `Ctrl+C` in the terminal running `dev.sh` or `dev.ps1`. Both the backend and frontend stop cleanly.

**Docker:**

```bash
docker compose down
```

Add `-v` to also remove the data volume (destructive — deletes the database, scripts, and logs):

```bash
docker compose down -v
```

---

## Troubleshooting

**Port 3000 or 8000 already in use**

Something else is occupying the port. Find and stop it:

```bash
# Mac / Linux
lsof -i :8000
lsof -i :3000

# Windows (PowerShell)
netstat -ano | findstr :8000
netstat -ano | findstr :3000
```

---

**`python3: command not found` (Mac/Linux)**

Install Python via your package manager or from https://python.org. On macOS with Homebrew:

```bash
brew install python
```

---

**`python: command not found` (Windows)**

Re-run the Python installer from https://python.org and ensure **"Add Python to PATH"** is checked. Then restart your PowerShell window.

---

**PowerShell says "running scripts is disabled"**

Run this once in an admin PowerShell, then retry `.\dev.ps1`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

**Frontend loads but API calls fail (spinning / errors in the UI)**

The Next.js dev server proxies all `/api/*` requests to `http://127.0.0.1:8000`. If those fail, the backend isn't running. Check for errors in the terminal or in `/tmp/sd-backend.log` (Mac/Linux), then restart the dev script.

---

**Container exits immediately on first start**

Check the logs:

```bash
docker compose logs dashboard
```

The most common cause is a volume path that doesn't exist or isn't writable. Ensure the host path in `volumes:` is a directory Docker can write to.
