#!/bin/sh
set -eu

# Render exposes RAVIN on PORT. OmniRoute stays private inside the same
# container on port 20128 so provider traffic never needs to be public.
export OMNIROUTE_PORT="${OMNIROUTE_PORT:-20128}"
export REQUIRE_API_KEY="${REQUIRE_API_KEY:-false}"
export DATA_DIR="${DATA_DIR:-/tmp/omniroute}"

mkdir -p "$DATA_DIR"

echo "Starting OmniRoute on 127.0.0.1:${OMNIROUTE_PORT}..."
omniroute --no-open --port "$OMNIROUTE_PORT" &
OMNI_PID=$!

cleanup() {
  kill "$OMNI_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting RAVIN web server..."
exec node server.js
