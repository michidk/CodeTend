#!/usr/bin/env bash
# Serves the production build together with the Eve runtime. Use this for the
# preview people actually look at: no Vite dev client, so nothing reloads the
# page when the server restarts, and first paint is an order of magnitude
# faster than `vite dev`.
#
# Rebuild with `bun run build` (or pass --build) after changing the app.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a

if [ "${1:-}" = "--build" ] || [ ! -f .output/server/index.mjs ]; then
  bun run build
fi
bun run db:migrate

EVE_RESTART_DELAY_SECONDS="${EVE_RESTART_DELAY_SECONDS:-3}"
children=()
shutdown() {
  trap - EXIT INT TERM
  if [ "${#children[@]}" -gt 0 ]; then
    kill "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
}
trap shutdown EXIT INT TERM

supervise_eve() {
  while true; do
    bash scripts/start-eve.sh || true
    echo "[start-preview] Eve exited; restarting in ${EVE_RESTART_DELAY_SECONDS}s" >&2
    sleep "$EVE_RESTART_DELAY_SECONDS"
  done
}

supervise_eve &
children+=("$!")

# The built server binds 0.0.0.0; the managed preview proxies to it locally.
PORT="${PORT:-3000}" NODE_ENV=production bun .output/server/index.mjs &
children+=("$!")
app_pid="$!"

wait "$app_pid"
