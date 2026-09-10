#!/usr/bin/env bash
# Starts the TanStack Start dev server and Eve runtime together. The managed
# preview needs one public HTTP endpoint, while the app reaches Eve over the
# pod's loopback interface.
#
# Eve is supervised independently: it is rebuilt and restarted often, and every
# exit used to take Vite down with it, which reloaded every open browser tab
# (Vite's client does location.reload() once the dev server comes back).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a

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
    echo "[start-dev] Eve exited; restarting in ${EVE_RESTART_DELAY_SECONDS}s" >&2
    sleep "$EVE_RESTART_DELAY_SECONDS"
  done
}

supervise_eve &
children+=("$!")

bun x vite dev --port "${PORT:-3000}" --host 127.0.0.1 &
children+=("$!")
vite_pid="$!"

# Only the app decides the preview's lifetime; Eve restarts in place.
wait "$vite_pid"
