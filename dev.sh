#!/usr/bin/env bash
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${CYAN}[info]${NC}  $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}    $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v python3 &>/dev/null || err "python3 not found — install from https://python.org"
command -v node    &>/dev/null || err "node not found — install from https://nodejs.org"
command -v npm     &>/dev/null || err "npm not found — install from https://nodejs.org"

# ── Backend venv ──────────────────────────────────────────────────────────────
if [ ! -d "$ROOT/backend/.venv" ]; then
  info "Creating Python virtual environment..."
  python3 -m venv "$ROOT/backend/.venv"
  ok "Virtual environment created"
fi

info "Installing backend dependencies..."
"$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt" -q
ok "Backend dependencies ready"

# ── Frontend deps ─────────────────────────────────────────────────────────────
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  info "Installing frontend dependencies..."
  npm install --prefix "$ROOT/frontend" --silent
  ok "Frontend dependencies ready"
fi

# ── Data directory ────────────────────────────────────────────────────────────
export DATA_DIR="$ROOT/data"
mkdir -p "$DATA_DIR"

# ── Process cleanup on exit ───────────────────────────────────────────────────
BACKEND_PID=""
cleanup() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    info "Stopping backend (PID $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# ── Start backend ─────────────────────────────────────────────────────────────
info "Starting backend..."
cd "$ROOT"
"$ROOT/backend/.venv/bin/uvicorn" backend.main:app --reload --port 8000 &>/tmp/sd-backend.log &
BACKEND_PID=$!
ok "Backend started (PID $BACKEND_PID) — logs: /tmp/sd-backend.log"

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│  Frontend  →  http://localhost:3000          │${NC}"
echo -e "${GREEN}│  API       →  http://localhost:8000          │${NC}"
echo -e "${GREEN}│  Ctrl+C to stop both                         │${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────┘${NC}"
echo ""

# ── Start frontend (foreground) ───────────────────────────────────────────────
npm run dev --prefix "$ROOT/frontend"
