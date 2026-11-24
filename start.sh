#!/usr/bin/env sh
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "Enabling pnpm via corepack..."
    corepack enable || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required. Install it with: npm install -g pnpm"
    exit 1
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

pnpm --filter @qr-scan/core build
pnpm --filter @qr-scan/web dev -- --open
