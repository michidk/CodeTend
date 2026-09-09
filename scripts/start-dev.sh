#!/usr/bin/env bash
# Starts the TanStack Start dev server with .env loaded (vibepod-preview passes PORT).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
exec bun x vite dev --port "${PORT:-3000}" --host 127.0.0.1
