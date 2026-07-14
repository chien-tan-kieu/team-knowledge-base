#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Required tools ──────────────────────────────────────────────

# Normalize Windows paths (Git Bash can return /c/Users/... or mixed slashes)
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ROOT="$(cygpath -m "$ROOT")" ;;
esac

command -v node >/dev/null 2>&1 || fail "node is not installed"
ok "node $(node --version)"

command -v pnpm >/dev/null 2>&1 || fail "pnpm is not installed"
ok "pnpm v$(pnpm --version)"

PYTHON=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" --version >/dev/null 2>&1; then
    PYTHON="$cmd"
    break
  fi
done
[ -n "$PYTHON" ] || fail "python is not installed"
ok "$PYTHON $($PYTHON --version 2>&1)"

command -v uv >/dev/null 2>&1 || fail "uv is not installed — see https://docs.astral.sh/uv/"
ok "uv $(uv --version 2>&1 | head -1)"

# ── Frontend dependencies ───────────────────────────────────────

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  warn "frontend/node_modules missing — running pnpm install"
  (cd "$ROOT" && pnpm install)
else
  ok "frontend dependencies installed"
fi

# ── Backend venv + Python deps ──────────────────────────────────

if [ ! -d "$ROOT/backend/.venv" ]; then
  warn "backend/.venv missing — running uv sync"
  (cd "$ROOT/backend" && uv sync --extra dev)
else
  ok "backend venv exists"
fi

# ── Backend .env ────────────────────────────────────────────────

if [ ! -f "$ROOT/backend/.env" ]; then
  warn "backend/.env missing — copying from .env.example"
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  warn "Edit backend/.env and set your secrets before running"
else
  ok "backend/.env exists"
fi

echo ""
ok "Preload complete — ready to run 'pnpm dev'"
