# Script-Dashboard — local dev launcher for Windows (PowerShell)
# Usage: .\dev.ps1
# Requires PowerShell 5.1+ (ships with Windows 10/11)
# If blocked by execution policy, run once as admin:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"

function Write-Info { param($msg) Write-Host "[info]  $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "[ok]    $msg" -ForegroundColor Green }
function Write-Err  { param($msg) Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Prerequisites ─────────────────────────────────────────────────────────────
if (-not (Get-Command python  -ErrorAction SilentlyContinue)) { Write-Err "python not found — install from https://python.org" }
if (-not (Get-Command node    -ErrorAction SilentlyContinue)) { Write-Err "node not found — install from https://nodejs.org" }
if (-not (Get-Command npm     -ErrorAction SilentlyContinue)) { Write-Err "npm not found — install from https://nodejs.org" }

# ── Backend venv ──────────────────────────────────────────────────────────────
if (-not (Test-Path "$Root\backend\.venv")) {
    Write-Info "Creating Python virtual environment..."
    python -m venv "$Root\backend\.venv"
    Write-Ok "Virtual environment created"
}

Write-Info "Installing backend dependencies..."
& "$Root\backend\.venv\Scripts\pip" install -r "$Root\backend\requirements.txt" --quiet
Write-Ok "Backend dependencies ready"

# ── Frontend deps ─────────────────────────────────────────────────────────────
if (-not (Test-Path "$Root\frontend\node_modules")) {
    Write-Info "Installing frontend dependencies..."
    npm install --prefix "$Root\frontend" --silent
    Write-Ok "Frontend dependencies ready"
}

# ── Data directory ────────────────────────────────────────────────────────────
$env:DATA_DIR = "$Root\data"
New-Item -ItemType Directory -Force -Path $env:DATA_DIR | Out-Null

# ── Start backend as background job ──────────────────────────────────────────
Write-Info "Starting backend..."
$BackendJob = Start-Job -ScriptBlock {
    param($root, $dataDir)
    $env:DATA_DIR = $dataDir
    Set-Location $root
    & "$root\backend\.venv\Scripts\uvicorn" backend.main:app --reload --port 8000
} -ArgumentList $Root, $env:DATA_DIR
Write-Ok "Backend started (Job ID $($BackendJob.Id)) — use 'Receive-Job $($BackendJob.Id)' to see logs"

Write-Host ""
Write-Host "┌─────────────────────────────────────────────┐" -ForegroundColor Green
Write-Host "│  Frontend  →  http://localhost:3000          │" -ForegroundColor Green
Write-Host "│  API       →  http://localhost:8000          │" -ForegroundColor Green
Write-Host "│  Ctrl+C to stop both                         │" -ForegroundColor Green
Write-Host "└─────────────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""

# ── Start frontend (foreground) — cleanup backend on any exit ─────────────────
try {
    Set-Location "$Root\frontend"
    npm run dev
} finally {
    Write-Info "Stopping backend job..."
    Stop-Job  $BackendJob -ErrorAction SilentlyContinue
    Remove-Job $BackendJob -ErrorAction SilentlyContinue
}
