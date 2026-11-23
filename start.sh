#!/usr/bin/env sh
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required: https://nodejs.org"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Enabling pnpm via corepack..."
  corepack enable
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

pnpm --filter @qr-scan/core build
pnpm --filter @qr-scan/web dev -- --open
