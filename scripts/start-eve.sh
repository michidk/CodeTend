#!/usr/bin/env bash
# Starts the Eve agent runtime with the app's .env so both share TECDEBT_DATA_DIR
# and credentials. Used by `vibepod-preview` / local development.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
export TECDEBT_DATA_DIR="$(realpath "${TECDEBT_DATA_DIR:-./data}")"
if [ "${GITNEXUS_ENABLED:-false}" = "true" ]; then
  export GITNEXUS_MCP_URL="http://127.0.0.1:${GITNEXUS_MCP_PORT:-3907}/mcp"
fi
cd eve
exec npx eve start --host 127.0.0.1 --port "${EVE_PORT:-2000}"
