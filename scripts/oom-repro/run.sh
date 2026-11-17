#!/usr/bin/env bash
# One arm of the OOM repro: boot the REAL server.js under the given runtime,
# point it at a deliberately slow sink, push N concurrent 64 MiB bodies through
# /api/*, and report the frontend process's peak RSS.
#
# Usage: run.sh [runtime] [concurrency]
#   runtime     bun (default) | node
#   concurrency default 4
#
# Every process it starts is killed by PID on exit. Never pkill by name.
set -uo pipefail

RUNTIME="${1:-bun}"
CONC="${2:-4}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

FE_PORT="${FE_PORT:-47183}"
SINK_PORT="${SINK_PORT:-47184}"

SINK_PID=""
FE_PID=""
cleanup() {
  [ -n "$FE_PID" ] && kill "$FE_PID" 2>/dev/null
  [ -n "$SINK_PID" ] && kill "$SINK_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

SINK_PORT="$SINK_PORT" node "$HERE/sink.js" >/tmp/oom-sink.log 2>&1 &
SINK_PID=$!

cd "$ROOT"
PORT="$FE_PORT" \
  W2V_API_URL="http://127.0.0.1:$SINK_PORT" \
  W2V_PROXY_TIMEOUT_MS=120000 \
  W2V_REQUEST_TIMEOUT_MS=180000 \
  W2V_HEADERS_TIMEOUT_MS=185000 \
  NODE_ENV=production \
  "$RUNTIME" "$ROOT/server.js" >/tmp/oom-fe.log 2>&1 &
FE_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:$FE_PORT/" --max-time 2; then break; fi
  sleep 0.5
done

BASE_RSS=$(ps -o rss= -p "$FE_PID" | tr -d ' ')

PEAK_FILE=$(mktemp)
echo "$BASE_RSS" > "$PEAK_FILE"
(
  while kill -0 "$FE_PID" 2>/dev/null; do
    r=$(ps -o rss= -p "$FE_PID" 2>/dev/null | tr -d ' ')
    [ -n "$r" ] && [ "$r" -gt "$(cat "$PEAK_FILE")" ] && echo "$r" > "$PEAK_FILE"
    sleep 0.1
  done
) &
SAMPLER_PID=$!

FE_PORT="$FE_PORT" CONCURRENCY="$CONC" node "$HERE/load.js"
LOAD_RC=$?

sleep 1
kill "$SAMPLER_PID" 2>/dev/null
PEAK=$(cat "$PEAK_FILE")

python3 - "$RUNTIME" "$CONC" "$BASE_RSS" "$PEAK" <<'PY'
import sys
rt, conc, base, peak = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
b, p = base/1024, peak/1024
print(f"RESULT runtime={rt} concurrency={conc} base_rss={b:.1f}MiB peak_rss={p:.1f}MiB retained={p-b:.1f}MiB per_part={(p-b)/conc:.1f}MiB")
PY

exit $LOAD_RC
