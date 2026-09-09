#!/usr/bin/env bash
# Starts the TanStack Start dev server and Eve runtime together. The managed
# preview needs one public HTTP endpoint, while the app reaches Eve over the
# pod's loopback interface.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a

children=()
shutdown() {
  trap - EXIT INT TERM
  if [ "${#children[@]}" -gt 0 ]; then
    kill "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
}
trap shutdown EXIT INT TERM

bash scripts/start-eve.sh &
children+=("$!")

bun x vite dev --port "${PORT:-3000}" --host 127.0.0.1 &
children+=("$!")

# End the managed preview if either required service exits; the EXIT trap
# tears down its sibling so a restart always begins from a clean pair.
wait -n "${children[@]}"
