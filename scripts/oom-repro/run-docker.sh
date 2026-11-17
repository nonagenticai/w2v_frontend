#!/usr/bin/env bash
# One arm of the OOM repro, run on LINUX bun (oven/bun:1.3.11-alpine — the same
# base and version as the production runtime stage), because the defect is
# platform-dependent: on macOS bun the same proxy path deadlocks instead of
# buffering, so a macOS-only measurement is not the production shape.
#
# The frontend runs in the container; the slow sink and the load generator run
# on the host under real node so neither can perturb the measurement.
# Peak RSS is read from /proc/<pid>/status VmHWM — a true high-water mark, not
# a sampled approximation.
#
# Usage: run-docker.sh [concurrency]
set -uo pipefail

CONC="${1:-4}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MAIN="$(cd "$ROOT/../.." && pwd)"   # main checkout: supplies node_modules + build

FE_PORT="${FE_PORT:-47183}"
SINK_PORT="${SINK_PORT:-47184}"
CONTAINER="${CONTAINER:-w2v-oom-repro}"
IMAGE="${IMAGE:-oven/bun:1.3.11-alpine}"
RUNTIME_CMD="${RUNTIME_CMD:-bun}"

SINK_PID=""
cleanup() {
  [ -n "$SINK_PID" ] && kill "$SINK_PID" 2>/dev/null
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  wait 2>/dev/null
}
trap cleanup EXIT
docker rm -f "$CONTAINER" >/dev/null 2>&1

SINK_PORT="$SINK_PORT" node "$HERE/sink.js" >/tmp/oom-sink.log 2>&1 &
SINK_PID=$!

docker run -d --name "$CONTAINER" \
  -p "$FE_PORT:$FE_PORT" \
  -v "$ROOT:/app" \
  -v "$MAIN/node_modules:/app/node_modules" \
  -v "$MAIN/build:/app/build" \
  -w /app \
  -e PORT="$FE_PORT" \
  -e W2V_API_URL="http://host.docker.test:$SINK_PORT" \
  -e W2V_PROXY_TIMEOUT_MS=300000 \
  -e W2V_REQUEST_TIMEOUT_MS=300000 \
  -e W2V_HEADERS_TIMEOUT_MS=305000 \
  -e NODE_ENV=production \
  --add-host host.docker.test:host-gateway \
  "$IMAGE" "$RUNTIME_CMD" /app/server.js >/dev/null || exit 1

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$FE_PORT/" --max-time 2 && break
  sleep 0.5
done

read_kb() { docker exec "$CONTAINER" sh -c "grep '$1' /proc/1/status | tr -dc '0-9'"; }
BASE_RSS=$(read_kb VmRSS)

FE_PORT="$FE_PORT" CONCURRENCY="$CONC" node "$HERE/load.js"
LOAD_RC=$?

PEAK=$(read_kb VmHWM)

python3 - "$CONC" "$BASE_RSS" "$PEAK" <<'PY'
import sys
conc, base, peak = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
b, p = base/1024, peak/1024
import os
print(f"RESULT runtime={os.environ.get('IMAGE','oven/bun:1.3.11-alpine')} concurrency={conc} base_rss={b:.1f}MiB peak_rss={p:.1f}MiB retained={p-b:.1f}MiB per_part={(p-b)/conc:.1f}MiB")
PY

exit $LOAD_RC
