#!/usr/bin/env bash
# Starts the Eve agent runtime with the app's .env so both share TECDEBT_DATA_DIR
# and credentials. Used by scripts/start-dev.sh, scripts/start-preview.sh and
# standalone local development.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
export TECDEBT_DATA_DIR="$(realpath "${TECDEBT_DATA_DIR:-./data}")"
if [ "${GITNEXUS_ENABLED:-false}" = "true" ]; then
  export GITNEXUS_MCP_URL="http://127.0.0.1:${GITNEXUS_MCP_PORT:-3907}/mcp"
fi
port="${EVE_PORT:-2000}"

# A previous Eve that outlived its supervisor keeps the port, so the new one
# fails to bind and the app keeps talking to the stale build. Only a process
# running this checkout's Eve bundle is stopped; anything else on the port is
# left alone and reported.
holder="$(ss -ltnpH "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
if [ -n "$holder" ]; then
  if tr '\0' ' ' < "/proc/${holder}/cmdline" 2>/dev/null | grep -q "$(pwd)/eve/.output/server/index.mjs"; then
    echo "[start-eve] stopping stale Eve (pid ${holder}) holding port ${port}" >&2
    kill "$holder" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$holder" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$holder" 2>/dev/null && kill -9 "$holder" 2>/dev/null || true
  else
    echo "[start-eve] port ${port} is held by pid ${holder}, which is not this checkout's Eve; refusing to start" >&2
    exit 1
  fi
fi

cd eve
exec npx eve start --host 127.0.0.1 --port "$port"
